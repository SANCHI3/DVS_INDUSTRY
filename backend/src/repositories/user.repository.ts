import type {
  IUserRepository,
  UserDto,
  CreateUserData,
  UpdateUserData,
  AdminUpdateUserData,
} from '../interfaces';
import { prisma } from '../lib/prismaClient';

// Fields returned on every user query — excludes password by default
const userSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  isActive: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
  role: {
    select: { id: true, name: true, description: true },
  },
} as const;

export class UserRepository implements IUserRepository {
  async findById(id: number): Promise<UserDto | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });
    return user ?? null;
  }

  /** Returns the user including their hashed password — ONLY used for auth. */
  async findByEmail(email: string): Promise<(UserDto & { password: string }) | null> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { ...userSelect, password: true },
    });
    return user ?? null;
  }

  async findAll(filters: { isActive?: boolean; roleId?: number } = {}): Promise<UserDto[]> {
    return prisma.user.findMany({
      where: filters,
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findEligibleEmployees(): Promise<UserDto[]> {
    return prisma.user.findMany({
      where: {
        isActive: true,
        employee: { is: { status: 'ACTIVE', deletedAt: null } },
      },
      select: userSelect,
      orderBy: { fullName: 'asc' },
    });
  }

  async create(data: CreateUserData): Promise<UserDto> {
    const user = await prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        password: data.password, // already hashed by service
        phone: data.phone ?? null,
        roleId: data.roleId,
        supplierId: data.supplierId ?? null,
        clientId: data.clientId ?? null,
      },
      select: userSelect,
    });
    return user;
  }

  async update(id: number, data: Partial<UpdateUserData>): Promise<UserDto> {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: userSelect,
    });
    return user;
  }

  async updateByAdmin(id: number, data: AdminUpdateUserData): Promise<UserDto> {
    return prisma.user.update({ where: { id }, data, select: userSelect });
  }

  async updateLastLogin(id: number): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: { lastLogin: new Date() },
    });
  }

  async updatePassword(id: number, hashedPassword: string): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
  }

  async deactivate(id: number): Promise<UserDto> {
    const user = await prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: userSelect,
    });
    return user;
  }
}
