import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    const emailConfig = this.configService.get('email');

    this.transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure, // true for 465, false for other ports
      auth: {
        user: emailConfig.user,
        pass: emailConfig.pass,
      },
    });
  }

  async sendReactivationEmail(email: string, name: string, reactivationLink: string) {
    try {
      const emailConfig = this.configService.get('email');
      const htmlContent = this.getReactivationEmailTemplate(name, reactivationLink);

      await this.transporter.sendMail({
        from: `"Aura Fit" <${emailConfig.user}>`,
        to: email,
        subject: 'Reative sua conta Aura Fit',
        html: htmlContent,
      });

      this.logger.log(`Reactivation email sent to ${email}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send reactivation email to ${email}`, error);
      throw error;
    }
  }

  async sendPasswordResetEmail(email: string, name: string, resetLink: string) {
    try {
      const emailConfig = this.configService.get('email');
      const htmlContent = this.getPasswordResetEmailTemplate(name, resetLink);

      await this.transporter.sendMail({
        from: `"Aura Fit" <${emailConfig.user}>`,
        to: email,
        subject: 'Recuperação de Senha - Aura Fit',
        html: htmlContent,
      });

      this.logger.log(`Password reset email sent to ${email}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}`, error);
      throw error;
    }
  }

  private getReactivationEmailTemplate(name: string, reactivationLink: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; background-color: #0a0e27; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
    .header { background: linear-gradient(135deg, #06b6d4 0%, #6366f1 100%); padding: 40px 30px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 28px; }
    .content { padding: 40px 30px; color: #333333; }
    .content h2 { color: #0a0e27; margin-top: 0; }
    .content p { line-height: 1.6; color: #555555; }
    .button { display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
    .button:hover { background: linear-gradient(135deg, #d97706 0%, #ea580c 100%); }
    .info-box { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .footer { background-color: #f3f4f6; padding: 30px; text-align: center; color: #6b7280; font-size: 14px; }
    .footer a { color: #06b6d4; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✨ Aura Fit</h1>
      <p style="color: #e0e7ff; margin: 10px 0 0 0;">Sua assistente de bem-estar</p>
    </div>
    
    <div class="content">
      <h2>Olá, ${name}!</h2>
      
      <p>Recebemos uma solicitação para <strong>reativar sua conta</strong> na Aura Fit.</p>
      
      <p>Para reativar sua conta e voltar a aproveitar todos os recursos da sua assistente pessoal de IA, clique no botão abaixo:</p>
      
      <div style="text-align: center;">
        <a href="${reactivationLink}" class="button">REATIVAR MINHA CONTA</a>
      </div>
      
      <div class="info-box">
        <strong>⏱️ Importante:</strong> Este link expira em <strong>24 horas</strong> por questões de segurança.
      </div>
      
      <p>Se você não solicitou a reativação da sua conta, pode ignorar este e-mail com segurança.</p>
      
      <p>Caso o botão acima não funcione, copie e cole o link abaixo no seu navegador:</p>
      <p style="word-break: break-all; color: #06b6d4; font-size: 12px;">${reactivationLink}</p>
    </div>
    
    <div class="footer">
      <p><strong>Aura Fit</strong> - Transformando vidas através da tecnologia</p>
      <p>Este é um e-mail automático, por favor não responda.</p>
      <p>Precisa de ajuda? <a href="mailto:suporte@aurafit.com">suporte@aurafit.com</a></p>
    </div>
  </div>
</body>
</html>
    `;
  }

  private getPasswordResetEmailTemplate(name: string, resetLink: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
      margin: 0; 
      padding: 0; 
      background-color: #0a0e27; 
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background-color: #ffffff; 
    }
    .header { 
      background: linear-gradient(135deg, #06b6d4 0%, #6366f1 100%); 
      padding: 40px 30px; 
      text-align: center; 
    }
    .header h1 { 
      color: #ffffff; 
      margin: 0; 
      font-size: 28px; 
      letter-spacing: -0.5px;
    }
    .header p { 
      color: #e0e7ff; 
      margin: 10px 0 0 0; 
      font-size: 15px;
    }
    .content { 
      padding: 40px 30px; 
      color: #333333; 
    }
    .content h2 { 
      color: #0a0e27; 
      margin-top: 0; 
      font-size: 24px;
    }
    .content p { 
      line-height: 1.6; 
      color: #555555; 
      font-size: 15px;
    }
    .button { 
      display: inline-block; 
      padding: 16px 32px; 
      background: linear-gradient(135deg, #06b6d4 0%, #6366f1 100%); 
      color: #ffffff; 
      text-decoration: none; 
      border-radius: 8px; 
      font-weight: 600; 
      margin: 20px 0;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
    }
    .button:hover { 
      background: linear-gradient(135deg, #0891b2 0%, #4f46e5 100%);
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.35);
    }
    .info-box { 
      background-color: #dbeafe; 
      border-left: 4px solid #06b6d4; 
      padding: 15px; 
      margin: 20px 0; 
      border-radius: 4px; 
    }
    .info-box strong {
      color: #0369a1;
    }
    .warning-box { 
      background-color: #fef3c7; 
      border-left: 4px solid #f59e0b; 
      padding: 15px; 
      margin: 20px 0; 
      border-radius: 4px; 
    }
    .warning-box strong {
      color: #d97706;
    }
    .footer { 
      background-color: #f3f4f6; 
      padding: 30px; 
      text-align: center; 
      color: #6b7280; 
      font-size: 14px; 
    }
    .footer a { 
      color: #06b6d4; 
      text-decoration: none; 
    }
    .footer a:hover {
      text-decoration: underline;
    }
    .link-fallback {
      word-break: break-all; 
      color: #06b6d4; 
      font-size: 12px;
      background-color: #f0f9ff;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #bae6fd;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 Aura Fit</h1>
      <p>Recuperação de Senha</p>
    </div>
    
    <div class="content">
      <h2>Olá, ${name}!</h2>
      
      <p>Recebemos uma solicitação para <strong>redefinir a senha</strong> da sua conta na Aura Fit.</p>
      
      <p>Tudo bem, isso acontece! Para criar uma nova senha e voltar a usar sua assistente pessoal de IA, clique no botão abaixo:</p>
      
      <div style="text-align: center;">
        <a href="${resetLink}" class="button">🔑 REDEFINIR SENHA</a>
      </div>
      
      <div class="info-box">
        <strong>⏱️ Validade:</strong> Este link expira em <strong>1 hora</strong> por questões de segurança.
      </div>
      
      <div class="warning-box">
        <strong>⚠️ Não solicitou?</strong> Se você não pediu para redefinir sua senha, pode ignorar este e-mail com segurança. Sua senha permanecerá a mesma e sua conta está protegida.
      </div>
      
      <p style="margin-top: 30px;">Caso o botão acima não funcione, copie e cole o link abaixo no seu navegador:</p>
      <p class="link-fallback">${resetLink}</p>
    </div>
    
    <div class="footer">
      <p><strong>Aura Fit</strong> - Transformando vidas através da tecnologia</p>
      <p>Este é um e-mail automático, por favor não responda.</p>
      <p>Precisa de ajuda? <a href="mailto:suporte@aurafit.com">suporte@aurafit.com</a></p>
    </div>
  </div>
</body>
</html>
    `;
  }
}
