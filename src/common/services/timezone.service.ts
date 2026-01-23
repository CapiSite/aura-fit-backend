import { Injectable } from '@nestjs/common';

/**
 * Serviço responsável por operações de data/hora no timezone correto.
 * 
 * Centraliza a lógica de timezone para evitar bugs comuns quando
 * o servidor roda em UTC mas a aplicação precisa operar em horário local.
 * 
 * @example
 * ```typescript
 * const { hour, minute } = this.timezoneService.getCurrentTime();
 * if (hour >= 6 && hour <= 23) {
 *   // Dentro do horário ativo
 * }
 * ```
 */
@Injectable()
export class TimezoneService {
  private readonly TIMEZONE = 'America/Sao_Paulo';
  private readonly LOCALE = 'pt-BR';

  /**
   * Retorna a hora e minuto atuais no timezone configurado.
   */
  getCurrentTime(date: Date = new Date()): { hour: number; minute: number } {
    const hourFormatter = new Intl.DateTimeFormat(this.LOCALE, {
      timeZone: this.TIMEZONE,
      hour: 'numeric',
      hour12: false,
    });

    const minuteFormatter = new Intl.DateTimeFormat(this.LOCALE, {
      timeZone: this.TIMEZONE,
      minute: 'numeric',
    });

    return {
      hour: parseInt(hourFormatter.format(date)),
      minute: parseInt(minuteFormatter.format(date)),
    };
  }

  /**
   * Retorna apenas a hora atual no timezone configurado.
   */
  getCurrentHour(date: Date = new Date()): number {
    return this.getCurrentTime(date).hour;
  }

  /**
   * Retorna a data atual formatada como 'YYYY-MM-DD' no timezone configurado.
   */
  getCurrentDateKey(date: Date = new Date()): string {
    const formatter = new Intl.DateTimeFormat(this.LOCALE, {
      timeZone: this.TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';

    return `${year}-${month}-${day}`;
  }

  /**
   * Verifica se a hora atual está dentro de um intervalo.
   * 
   * @param startHour - Hora de início (inclusive)
   * @param endHour - Hora de fim (inclusive)
   */
  isWithinHourRange(
    startHour: number,
    endHour: number,
    date: Date = new Date(),
  ): boolean {
    const currentHour = this.getCurrentHour(date);
    return currentHour >= startHour && currentHour <= endHour;
  }

  /**
   * Verifica se o horário atual está dentro de uma janela de tempo específica.
   * 
   * @param windowStartHour - Hora de início da janela
   * @param windowStartMinute - Minuto de início da janela
   * @param windowDurationMinutes - Duração da janela em minutos
   */
  isWithinTimeWindow(
    windowStartHour: number,
    windowStartMinute: number,
    windowDurationMinutes: number,
    date: Date = new Date(),
  ): boolean {
    const { hour, minute } = this.getCurrentTime(date);

    // Converte para minutos do dia para facilitar comparação
    const currentTotalMinutes = hour * 60 + minute;
    const windowStartMinutes = windowStartHour * 60 + windowStartMinute;
    const windowEndMinutes = windowStartMinutes + windowDurationMinutes;

    return (
      currentTotalMinutes >= windowStartMinutes &&
      currentTotalMinutes <= windowEndMinutes
    );
  }

  /**
   * Parse de string de tempo no formato HH:mm para hora e minuto.
   * Retorna valores padrão se o formato for inválido.
   */
  parseTimeString(
    timeString: string | null,
    defaultHour: number = 0,
    defaultMinute: number = 0,
  ): { hour: number; minute: number } {
    if (!timeString) {
      return { hour: defaultHour, minute: defaultMinute };
    }

    const parts = timeString.split(':');
    if (parts.length !== 2) {
      return { hour: defaultHour, minute: defaultMinute };
    }

    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);

    const isValidHour = !isNaN(hour) && hour >= 0 && hour < 24;
    const isValidMinute = !isNaN(minute) && minute >= 0 && minute < 60;

    if (!isValidHour || !isValidMinute) {
      return { hour: defaultHour, minute: defaultMinute };
    }

    return { hour, minute };
  }
}
