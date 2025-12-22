import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma_connection/prisma.service';

type Tool = {
  name: string;
  description?: string;
  parametersSchema?: any;
  handler: (args: any) => any | Promise<any>;
};

@Injectable()
export class McpService {
  private tools: Map<string, Tool> = new Map();

  constructor(private readonly prisma: PrismaService) {
    this.registerTool({
      name: 'getUserProfile',
      description:
        'Obtém o perfil completo de um usuário com base no número de telefone do WhatsApp.',
      parametersSchema: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'number',
            description: 'O número de telefone do usuário (WhatsApp).',
          },
        },
        required: ['phoneNumber'],
      },
      handler: async (args: { phoneNumber: number }) => {
        const { phoneNumber } = args;
        if (!phoneNumber) {
          return { error: 'O parâmetro phoneNumber é obrigatório.' };
        }

        const phoneNumberStr = String(phoneNumber);

        const profile = await this.prisma.userProfile.findUnique({
          where: { phoneNumber: phoneNumberStr },
        });

        if (!profile) {
          return { error: `Perfil não encontrado para o phoneNumber: ${phoneNumber}` };
        }

        // Converte BigInt para string para garantir a serialização em JSON
        return JSON.parse(
          JSON.stringify(profile, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
        );
      },
    });

    this.registerTool({
      name: 'updateUserProfile',
      description:
        'Atualiza o perfil do usuário com informações como peso, altura, objetivos, restrições, etc.',
      parametersSchema: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'number',
            description: 'O número de telefone do usuário (WhatsApp).',
          },
          name: { type: 'string', description: 'Nome do usuário' },
          weight: { type: 'number', description: 'Peso em kg' },
          height: { type: 'number', description: 'Altura em cm' },
          activityLevel: {
            type: 'string',
            description:
              'Nível de atividade (SEDENTARIO, LEVE, MODERADO, INTENSO, MUITO_INTENSO)',
          },
          workType: { type: 'string', description: 'Tipo de trabalho' },
          goals: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista de objetivos',
          },
          dietaryRestrictions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Restrições alimentares',
          },
          preferences: {
            type: 'array',
            items: { type: 'string' },
            description: 'Preferências alimentares',
          },
          allergies: {
            type: 'array',
            items: { type: 'string' },
            description: 'Alergias',
          },
          medicalConditions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Condições médicas',
          },
          medications: {
            type: 'array',
            items: { type: 'string' },
            description: 'Medicamentos em uso',
          },
          usualMealsPerDay: {
            type: 'number',
            description: 'Número de refeições por dia',
          },
          wakeTime: {
            type: 'string',
            description: 'Horário de acordar (HH:MM)',
          },
          sleepTime: {
            type: 'string',
            description: 'Horário de dormir (HH:MM)',
          },
          planStyle: {
            type: 'string',
            description: 'Estilo do plano alimentar',
          },
          waterReminderEnabled: {
            type: 'boolean',
            description: 'Se os lembretes de água estão ativados',
          },
          waterReminderIntervalMinutes: {
            type: 'number',
            description: 'Intervalo em MINUTOS entre lembretes de água (ex: 60=1h, 120=2h, 180=3h)',
          },
          timezone: {
            type: 'string',
            description: 'Fuso horário do usuário (ex: America/Sao_Paulo, America/New_York)',
          },
        },
        required: ['phoneNumber'],
      },
      handler: async (args: any) => {
        const { phoneNumber, ...data } = args;
        if (!phoneNumber) return { error: 'phoneNumber é obrigatório' };

        const phoneNumberStr = String(phoneNumber);

        try {
          const updated = await this.prisma.userProfile.update({
            where: { phoneNumber: phoneNumberStr },
            data: data,
          });

          return JSON.parse(
            JSON.stringify(updated, (key, value) =>
              typeof value === 'bigint' ? value.toString() : value,
            ),
          );
        } catch (error) {
          return { error: `Erro ao atualizar perfil: ${error.message}` };
        }
      },
    });
  }

  health() {
    return { status: 'ok' };
  }

  getTools() {
    return Array.from(this.tools.values()).map(
      ({ name, description, parametersSchema }) => ({
        name,
        description,
        parametersSchema,
      }),
    );
  }

  registerTool(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  async callTool(name: string, args: any) {
    const tool = this.tools.get(name);
    if (!tool) {
      return { error: `Ferramenta não encontrada: ${name}` };
    }
    const result = await tool.handler(args ?? {});
    return { name, result };
  }
}