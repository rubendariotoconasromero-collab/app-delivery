import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthenticatedUser, UserRole } from './auth.types';

export const PUBLIC_ROUTE = 'appdelivery:public';
export const REQUIRED_ROLES = 'appdelivery:roles';
export const EXISTING_TRIP_ACCESS = 'appdelivery:existing-trip';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(REQUIRED_ROLES, roles);
export const ExistingTripAccess = () => SetMetadata(EXISTING_TRIP_ACCESS, true);
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
