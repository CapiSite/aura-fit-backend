import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':chatId')
  findOne(@Param('chatId') chatId: string) {
    return this.usersService.findOne(chatId);
  }

  @Patch(':chatId')
  update(@Param('chatId') chatId: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(chatId, updateUserDto);
  }

  @Delete(':chatId')
  remove(@Param('chatId') chatId: string) {
    return this.usersService.remove(chatId);
  }
}
