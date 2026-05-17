import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isIP } from 'node:net';

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.test',
  '.invalid',
  '.example',
];

@ValidatorConstraint({ name: 'isSafePublicHttpsUrl', async: false })
export class IsSafePublicHttpsUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }

    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return false;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedValue);
    } catch {
      return false;
    }

    if (parsedUrl.protocol !== 'https:') {
      return false;
    }

    if (parsedUrl.username || parsedUrl.password) {
      return false;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (!hostname) {
      return false;
    }

    if (hostname === 'localhost') {
      return false;
    }

    if (isIP(hostname) !== 0) {
      return false;
    }

    if (!hostname.includes('.')) {
      return false;
    }

    if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return false;
    }

    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Link must be a public HTTPS URL and cannot point to localhost, local domains, or IP addresses.';
  }
}

export function IsSafePublicHttpsUrl(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      constraints: [],
      validator: IsSafePublicHttpsUrlConstraint,
    });
  };
}
