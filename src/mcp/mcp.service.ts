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
        'Obtém o perfil completo de um usuário com base no ID do chat do Telegram.',
      parametersSchema: {
        type: 'object',
        properties: {
          chatId: {
            type: 'number',
            description: 'O ID do chat do Telegram do usuário.',
          },
        },
        required: ['chatId'],
      },
      handler: async (args: { chatId: number }) => {
        const { chatId } = args;
        if (!chatId) {
          return { error: 'O parâmetro chatId é obrigatório.' };
        }

        const prismaChatId = String(chatId);

        const profile = await this.prisma.userProfile.findUnique({
          where: { chatId: prismaChatId },
        });

        if (!profile) {
          return { error: `Perfil não encontrado para o chatId: ${chatId}` };
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
          chatId: {
            type: 'number',
            description: 'O ID do chat do Telegram do usuário.',
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
        },
        required: ['chatId'],
      },
      handler: async (args: any) => {
        const { chatId, ...data } = args;
        if (!chatId) return { error: 'chatId é obrigatório' };

        const prismaChatId = String(chatId);

        try {
          const updated = await this.prisma.userProfile.update({
            where: { chatId: prismaChatId },
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