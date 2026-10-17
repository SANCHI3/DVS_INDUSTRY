import { describe, expect, it, vi } from 'vitest';
import {
  PASSWORD_CHANGED_MESSAGE,
  checkPasswordChange,
  roleDisplayName,
  submitPasswordChange,
  type PasswordChange,
} from '../profile';

const form = (overrides: Partial<PasswordChange> = {}): PasswordChange => ({
  currentPassword: 'Old@pass1',
  newPassword: 'New@pass22',
  confirmPassword: 'New@pass22',
  ...overrides,
});

describe('change-password form', () => {
  it('blocks mismatched new passwords without calling the API', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await submitPasswordChange(form({ confirmPassword: 'New@pass23' }), send);

    expect(result).toEqual({ ok: false, message: 'The two new passwords do not match.' });
    expect(send).not.toHaveBeenCalled();
  });

  it('shows the success message after the backend accepts the change', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await submitPasswordChange(form(), send);

    expect(send).toHaveBeenCalledWith(form());
    expect(result).toEqual({ ok: true, message: PASSWORD_CHANGED_MESSAGE });
    expect(PASSWORD_CHANGED_MESSAGE).toBe('Password changed. Please log in again.');
  });

  it('shows the backend message when the current password is wrong', async () => {
    const send = vi.fn().mockRejectedValue({ status: 400, code: 'BAD_REQUEST', message: 'Current password is incorrect' });
    const result = await submitPasswordChange(form(), send);

    expect(result).toEqual({ ok: false, message: 'Current password is incorrect' });
  });

  it('lists the password rules the new password is missing', () => {
    expect(checkPasswordChange(form({ newPassword: 'short', confirmPassword: 'short' })))
      .toBe('The new password needs: at least 8 characters; one capital letter (A-Z); one number (0-9); one symbol, such as ! @ # $ %.');
    expect(checkPasswordChange(form({ currentPassword: '' }))).toBe('Enter your current password.');
    expect(checkPasswordChange(form({ newPassword: 'Old@pass1', confirmPassword: 'Old@pass1' })))
      .toBe('The new password must be different from your current one.');
    expect(checkPasswordChange(form())).toBeNull();
  });
});

describe('roleDisplayName', () => {
  it('names roles in plain words', () => {
    expect(roleDisplayName('STORE')).toBe('Store Keeper');
    expect(roleDisplayName('ADMIN')).toBe('Administrator');
    expect(roleDisplayName('NEW_ROLE')).toBe('New Role');
  });
});
