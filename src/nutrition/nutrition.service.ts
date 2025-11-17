import { Injectable } from '@nestjs/common';
import { CreateNutritionDto } from './dto/create-nutrition.dto';
import { UpdateNutritionDto } from './dto/update-nutrition.dto';

@Injectable()
export class NutritionService {
  buildPrompt(userText: string, systemBase?: string) {
    const base = systemBase?.trim() ?? '';
    const domain =
      'Monte planos alimentares personalizados e objetivos. Sempre considere objetivo (perder, manter, ganhar peso), ' +
      'restricoes alimentares, preferencias e rotina. Confirme duvidas rapidamente se faltar contexto. Seja direta e amigavel.';

    const header = base ? `${base}\n\n${domain}` : domain;
    return `${header}\n\nUsuario: ${userText}`;
  }

  create(createNutritionDto: CreateNutritionDto) {
    return 'This action adds a new nutrition';
  }

  findAll() {
    return `This action returns all nutrition`;
  }

  findOne(id: number) {
    return `This action returns a #${id} nutrition`;
  }

  update(id: number, updateNutritionDto: UpdateNutritionDto) {
    return `This action updates a #${id} nutrition`;
  }

  remove(id: number) {
    return `This action removes a #${id} nutrition`;
  }
}
