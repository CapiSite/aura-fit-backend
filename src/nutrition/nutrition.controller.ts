import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { NutritionService } from './nutrition.service';
import { CreateNutritionDto } from './dto/create-nutrition.dto';
import { UpdateNutritionDto } from './dto/update-nutrition.dto';

@Controller('nutrition')
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) { }

}
