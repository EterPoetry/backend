import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

interface UserUniqueConstraintDescriptor {
  field: 'email' | 'username' | 'googleId';
  message: string;
  code: string;
}

export interface UserConflictError {
  field: UserUniqueConstraintDescriptor['field'];
  message: string;
  code: string;
}

const USER_UNIQUE_CONSTRAINTS: Record<string, UserUniqueConstraintDescriptor> = {
  UQ_users_email: {
    field: 'email',
    message: 'Email is already registered.',
    code: 'EMAIL_NOT_UNIQUE',
  },
  UQ_users_username: {
    field: 'username',
    message: 'Username is already taken.',
    code: 'USERNAME_NOT_UNIQUE',
  },
  UQ_users_google_id: {
    field: 'googleId',
    message: 'Google account is already linked to another user.',
    code: 'GOOGLE_ID_NOT_UNIQUE',
  },
};

interface PostgresDriverError {
  code?: string;
  constraint?: string;
}

export function getUserConflictError(
  field: UserUniqueConstraintDescriptor['field'],
): UserConflictError | null {
  const descriptor = Object.values(USER_UNIQUE_CONSTRAINTS).find(
    (constraint) => constraint.field === field,
  );

  if (!descriptor) {
    return null;
  }

  return {
    code: descriptor.code,
    field: descriptor.field,
    message: descriptor.message,
  };
}

export function createUserConflictException(
  field: UserUniqueConstraintDescriptor['field'],
): ConflictException {
  const error = getUserConflictError(field);
  return createUserConflictsException(error ? [error] : []);
}

export function createUserConflictsException(errors: UserConflictError[]): ConflictException {
  if (errors.length === 0) {
    return new ConflictException('User data conflicts with an existing record.');
  }

  return new ConflictException({
    message: 'User data conflicts with existing records.',
    errors,
  });
}

export function rethrowUserUniqueConstraint(error: unknown): never {
  const driverError = (error as QueryFailedError & { driverError?: PostgresDriverError })
    ?.driverError;

  if (driverError?.code === '23505' && driverError.constraint) {
    const descriptor = USER_UNIQUE_CONSTRAINTS[driverError.constraint];
    if (descriptor) {
      throw createUserConflictsException([
        {
          code: descriptor.code,
          field: descriptor.field,
          message: descriptor.message,
        },
      ]);
    }
  }

  throw error;
}
