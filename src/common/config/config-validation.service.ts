import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ConfigValidationService implements OnModuleInit {
  private readonly logger = new Logger(ConfigValidationService.name);

  constructor(private readonly config: ConfigService) { }

  onModuleInit() {
    this.validateEmailConfig();
  }

  private validateEmailConfig() {
    const requiredVars = {
      EMAIL_HOST: this.config.get<string>('EMAIL_HOST'),
      EMAIL_PORT: this.config.get<string>('EMAIL_PORT'),
      EMAIL_USER: this.config.get<string>('EMAIL_USER'),
      EMAIL_PASS: this.config.get<string>('EMAIL_PASS'),
      FRONTEND_URL: this.config.get<string>('FRONTEND_URL'),
    };

    const missing: string[] = [];
    const configured: string[] = [];

    Object.entries(requiredVars).forEach(([key, value]) => {
      if (!value || value === '') {
        missing.push(key);
      } else {
        // Mascara senha
        const displayValue = key === 'EMAIL_PASS'
          ? '********'
          : value;
        configured.push(`${key}=${displayValue}`);
      }
    });

    if (missing.length > 0) {
      this.logger.error('❌ Email configuration INCOMPLETE!');
      this.logger.error(`Missing variables: ${missing.join(', ')}`);
      this.logger.warn('📧 Email sending will FAIL until these are configured!');
      this.logger.warn('📖 See: ENV_CONFIG_GUIDE.md');
    } else {
      this.logger.log('✅ Email configuration OK!');
      configured.forEach(conf => this.logger.log(`   ${conf}`));
    }
  }
}
