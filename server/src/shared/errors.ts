/** Єдиний формат помилок API (api-contract.md §1.4). */

export interface ErrorDetail {
  field?: string;
  rule?: string;
  message?: string;
}

export class AppError extends Error {
  constructor(
    public readonly http: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  unauthenticated: (message = 'Необхідна автентифікація') =>
    new AppError(401, 'UNAUTHENTICATED', message),
  tokenExpired: () => new AppError(401, 'TOKEN_EXPIRED', 'Термін дії access-токена вичерпано'),
  refreshTokenInvalid: () =>
    new AppError(401, 'REFRESH_TOKEN_INVALID', 'Refresh-токен недійсний. Увійдіть знову'),
  roleForbidden: (message = 'Недостатньо прав для цієї дії') =>
    new AppError(403, 'ROLE_FORBIDDEN', message),
  stationScopeViolation: () =>
    new AppError(403, 'STATION_SCOPE_VIOLATION', 'Доступ до чужої станції заборонено'),
  userDeactivated: () =>
    new AppError(403, 'USER_DEACTIVATED', 'Обліковий запис деактивовано. Зверніться до адміністратора'),
  notFound: (message = 'Запис не знайдено') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  duplicateName: (message: string) => new AppError(409, 'DUPLICATE_NAME', message),
  validation: (message = 'Некоректні дані запиту', details?: ErrorDetail[]) =>
    new AppError(422, 'VALIDATION_ERROR', message, details),
  internal: () => new AppError(500, 'INTERNAL', 'Внутрішня помилка сервера'),
};
