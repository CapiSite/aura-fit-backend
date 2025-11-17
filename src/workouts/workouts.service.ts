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

  create(createWorkoutDto: CreateWorkoutDto) {
    return 'This action adds a new workout';
  }

  findAll() {
    return `This action returns all workouts`;
  }

  findOne(id: number) {
    return `This action returns a #${id} workout`;
  }

  update(id: number, updateWorkoutDto: UpdateWorkoutDto) {
    return `This action updates a #${id} workout`;
  }

  remove(id: number) {
    return `This action removes a #${id} workout`;
  }
}
