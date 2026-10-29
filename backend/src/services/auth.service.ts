import bcrypt from 'bcrypt';
import { env } from '../config/env';
import {
  UserRepository,
  RoleRepository,
  RefreshTokenRepository,
  PasswordResetTokenRepository,
} from '../repositories';
import type {
  UserDto,
  TokenPair,
  CreateUserData,
  UpdateUserData,
  AdminUpdateUserData,
  ChangePasswordData,
} from '../interfaces';
import {
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} from '../errors';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  parseExpiresInMs,
  generateJti,
  generateOpaqueToken,
} from '../utils/token';
import { sendPasswordResetEmail } from '../utils/mailer';
import { logger } from '../logger';
import { REFRESH_ROTATION_GRACE_MS } from '../constants';

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1_000;

// A real bcrypt hash of a random string, used to equalise login timing when
// the email does not exist (a malformed hash makes bcrypt return instantly).
const DUMMY_PASSWORD_HASH = '$2b$12$z93IcE2sHjxjwGNUV9laU.rGPXxyL58lr2Dz6fcyqj2nOPZ7x0oiG';

export class AuthService {
  private readonly userRepo: UserRepository;
  private readonly roleRepo: RoleRepository;
  private readonly refreshTokenRepo: RefreshTokenRepository;
  private readonly resetTokenRepo: PasswordResetTokenRepository;

  constructor() {
    this.userRepo = new UserRepository();
    this.roleRepo = new RoleRepository();
    this.refreshTokenRepo = new RefreshTokenRepository();
    this.resetTokenRepo = new PasswordResetTokenRepository();
  }

  // ── Register (Admin only) ─────────────────────────────────────────────────

  async register(data: CreateUserData): Promise<UserDto> {
    const existing = await this.userRepo.findByEmail(data.email);
    if (existing !== null) {
      throw new ConflictError('A user with this email already exists');
    }

    const role = await this.roleRepo.findById(data.roleId);
    if (role === null) {
      throw new BadRequestError(`Role with id ${data.roleId} does not exist`);
    }

    const hashedPassword = await bcrypt.hash(data.password, env.BCRYPT_SALT_ROUNDS);

    return this.userRepo.create({ ...data, password: hashedPassword });
  }

  async getUsers(): Promise<UserDto[]> {
    return this.userRepo.findAll();
  }

  async getEligibleEmployees(): Promise<UserDto[]> {
    return this.userRepo.findEligibleEmployees();
  }

  async updateUser(
    adminId: number,
    targetUserId: number,
    data: AdminUpdateUserData,
  ): Promise<UserDto> {
    const existing = await this.userRepo.findById(targetUserId);
    if (existing === null) throw new NotFoundError('User not found');

    const roleChanged = data.roleId !== undefined && data.roleId !== existing.role.id;
    if (roleChanged && adminId === targetUserId) {
      // Prevents an admin from accidentally locking themselves out
      throw new BadRequestError('You cannot change your own role');
    }

    if (data.email !== undefined) {
      const account = await this.userRepo.findByEmail(data.email);
      if (account !== null && account.id !== targetUserId) {
        throw new ConflictError('A user with this email already exists');
      }
    }

    if (data.roleId !== undefined && (await this.roleRepo.findById(data.roleId)) === null) {
      throw new BadRequestError(`Role with id ${data.roleId} does not exist`);
    }

    const updated = await this.userRepo.updateByAdmin(targetUserId, data);

    // A role change must not leave sessions running with the old privileges
    if (roleChanged) {
      await this.refreshTokenRepo.deleteAllByUserId(targetUserId);
    }
    return updated;
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<{ user: UserDto; tokens: TokenPair }> {
    const userWithPassword = await this.userRepo.findByEmail(email);

    if (userWithPassword === null) {
      // Equalise timing — don't reveal whether the email exists
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedError('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, userWithPassword.password);

    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Only reveal the account status to someone who knows the password
    if (!userWithPassword.isActive) {
      throw new ForbiddenError('Your account has been deactivated');
    }

    await this.userRepo.updateLastLogin(userWithPassword.id);

    const tokens = await this.issueTokenPair(
      userWithPassword.id,
      userWithPassword.email,
      userWithPassword.role.name,
    );

    // Strip password from returned user object
    const { password: _pw, ...user } = userWithPassword;
    return { user, tokens };
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokenRepo.deleteByToken(refreshToken);
  }

  // ── Refresh Tokens ────────────────────────────────────────────────────────

  async refreshTokens(rawRefreshToken: string): Promise<TokenPair> {
    // 1. Verify JWT signature and expiry
    let payload;
    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // 2. Check it still exists in DB (detect theft / reuse)
    const storedToken = await this.refreshTokenRepo.findByToken(rawRefreshToken);
    if (storedToken === null) {
      // Token rotation attack — invalidate all tokens for this user
      await this.refreshTokenRepo.deleteAllByUserId(payload.sub);
      logger.warn('Refresh token reuse detected — all tokens revoked', {
        userId: payload.sub,
      });
      throw new UnauthorizedError('Refresh token reuse detected. Please log in again.');
    }

    if (storedToken.expiresAt < new Date()) {
      await this.refreshTokenRepo.deleteByToken(rawRefreshToken);
      throw new UnauthorizedError('Refresh token has expired');
    }

    // 3. Check user still exists and is active
    const user = await this.userRepo.findById(payload.sub);
    if (user === null || !user.isActive) {
      throw new UnauthorizedError('User not found or account deactivated');
    }

    // 4. Rotate — keep the old token for a grace period, issue a new pair.
    //    A token rotated within the grace period is a retried refresh whose
    //    response was lost, not theft; it gets a fresh pair too.
    const now = Date.now();
    if (storedToken.replacedAt === null) {
      await this.refreshTokenRepo.markReplaced(rawRefreshToken);
    } else if (now - storedToken.replacedAt.getTime() > REFRESH_ROTATION_GRACE_MS) {
      await this.refreshTokenRepo.deleteAllByUserId(payload.sub);
      logger.warn('Refresh token reuse detected — all tokens revoked', {
        userId: payload.sub,
      });
      throw new UnauthorizedError('Refresh token reuse detected. Please log in again.');
    }
    await this.refreshTokenRepo.deleteReplacedBefore(
      user.id,
      new Date(now - REFRESH_ROTATION_GRACE_MS),
    );
    return this.issueTokenPair(user.id, user.email, user.role.name);
  }

  // ── Change Password ───────────────────────────────────────────────────────

  async changePassword(userId: number, data: ChangePasswordData): Promise<void> {
    const userWithPassword = await this.userRepo.findByEmail(
      (await this.userRepo.findById(userId))?.email ?? '',
    );

    if (userWithPassword === null) {
      throw new NotFoundError('User not found');
    }

    const isValid = await bcrypt.compare(data.currentPassword, userWithPassword.password);
    if (!isValid) {
      throw new BadRequestError('Current password is incorrect');
    }

    if (data.currentPassword === data.newPassword) {
      throw new BadRequestError('New password must be different from the current password');
    }

    const hashed = await bcrypt.hash(data.newPassword, env.BCRYPT_SALT_ROUNDS);
    await this.userRepo.updatePassword(userId, hashed);

    // Invalidate all refresh tokens — force re-login on all devices
    await this.refreshTokenRepo.deleteAllByUserId(userId);
  }

  // ── Forgot Password ───────────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const user = await this.userRepo.findByEmail(email);

    // Respond identically either way — don't reveal whether the email exists
    if (user === null || !user.isActive) {
      logger.info('Forgot password requested for unknown or inactive account');
      return;
    }

    const rawToken = generateOpaqueToken();
    await this.resetTokenRepo.replaceForUser(
      user.id,
      rawToken,
      new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    );

    const resetUrl = `${env.APP_URL.replace(/\/$/, '')}/?resetToken=${rawToken}`;
    await sendPasswordResetEmail(user.email, resetUrl);
    logger.info('Password reset token issued', { userId: user.id });

    // Opportunistic cleanup of stale tokens
    void this.resetTokenRepo.deleteExpired().catch(() => undefined);
  }

  // ── Reset Password ────────────────────────────────────────────────────────

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const userId = await this.resetTokenRepo.consume(rawToken);
    if (userId === null) {
      throw new BadRequestError('Password reset token is invalid or has expired');
    }

    const hashed = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);
    await this.userRepo.updatePassword(userId, hashed);

    // Revoke all sessions
    await this.refreshTokenRepo.deleteAllByUserId(userId);
  }

  // ── Get Current User ──────────────────────────────────────────────────────

  async getMe(userId: number): Promise<UserDto> {
    const user = await this.userRepo.findById(userId);
    if (user === null) throw new NotFoundError('User not found');
    return user;
  }

  // ── Update Profile ────────────────────────────────────────────────────────

  async updateProfile(userId: number, data: Partial<UpdateUserData>): Promise<UserDto> {
    const user = await this.userRepo.findById(userId);
    if (user === null) throw new NotFoundError('User not found');
    return this.userRepo.update(userId, data);
  }

  // ── Deactivate User (Admin only) ──────────────────────────────────────────

  async deactivateUser(adminId: number, targetUserId: number): Promise<UserDto> {
    if (adminId === targetUserId) {
      throw new BadRequestError('You cannot deactivate your own account');
    }

    const target = await this.userRepo.findById(targetUserId);
    if (target === null) throw new NotFoundError('User not found');
    if (!target.isActive) {
      throw new BadRequestError('User is already deactivated');
    }

    const deactivated = await this.userRepo.deactivate(targetUserId);

    // Revoke all sessions for the deactivated user
    await this.refreshTokenRepo.deleteAllByUserId(targetUserId);

    return deactivated;
  }

  // ── Roles ─────────────────────────────────────────────────────────────────

  async getRoles() {
    return this.roleRepo.findAll();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async issueTokenPair(
    userId: number,
    email: string,
    roleName: string,
  ): Promise<TokenPair> {
    const jti = generateJti();

    const accessToken = generateAccessToken({ sub: userId, email, role: roleName });
    const refreshToken = generateRefreshToken({ sub: userId, jti });

    const expiresAt = new Date(Date.now() + parseExpiresInMs(env.REFRESH_TOKEN_EXPIRES_IN));

    await this.refreshTokenRepo.create({
      token: refreshToken,
      userId,
      expiresAt,
    });

    return { accessToken, refreshToken };
  }
}
