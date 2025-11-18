import { Injectable } from '@nestjs/common';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { UpdateWorkoutDto } from './dto/update-workout.dto';

@Injectable()
export class WorkoutsService {
  buildPrompt(userText: string, systemBase?: string) {
    const base = systemBase?.trim() ?? '';
    const domain =
      'Crie treinos personalizados considerando nivel (iniciante, intermediario, avancado), frequencia semanal, ' +
      'tempo disponivel e equipamentos. Se faltar contexto, faça perguntas rapidas antes de propor o treino. Seja direto e amigavel.';

    const header = base ? `${base}\n\n${domain}` : domain;
    return `${header}\n\nUsuario: ${userText}`;
  }

}
