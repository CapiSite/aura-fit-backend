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

}
