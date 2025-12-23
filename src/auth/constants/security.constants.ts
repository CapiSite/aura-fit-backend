/**
 * Constantes de Segurança para Autenticação
 */

// Tokens
export const TOKEN_EXPIRATION = {
  REACTIVATION: 24 * 60 * 60 * 1000, // 24 horas em ms
  PASSWORD_RESET: 60 * 60 * 1000,    // 1 hora em ms
  AUTH: 24 * 60 * 60 * 1000,         // 24 horas em ms
};

// Senhas
export const PASSWORD_REQUIREMENTS = {
  MIN_LENGTH: 8,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBER: true,
  REQUIRE_SPECIAL: false, // Pode ativar se quiser
};

// Rate Limiting (requests por IP)
export const RATE_LIMITS = {
  PASSWORD_RESET_PER_HOUR: 3,
  REACTIVATION_PER_HOUR: 3,
  LOGIN_ATTEMPTS_PER_15MIN: 5,
};

// Segurança de Tokens
export const TOKEN_SECURITY = {
  RANDOM_BYTES: 32,            // Tamanho do token em bytes
  ENCODING: 'hex' as const,    // Tipo de encoding
  CLEANUP_EXPIRED_AFTER_DAYS: 7, // Limpar tokens expirados após X dias
};

// Mensagens genéricas (não revelar informações)
export const GENERIC_MESSAGES = {
  TOKEN_SENT: 'Se o e-mail existir, enviamos instruções',
  PASSWORD_RESET_SENT: 'Se o e-mail existir, enviamos instruções de recuperação',
  REACTIVATION_SENT: 'Se o e-mail existir e a conta estiver desativada, enviamos instruções',
};
