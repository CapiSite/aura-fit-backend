import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { AuthAdminGuard } from '../common/guards/admin.guard';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @UseGuards(AuthAdminGuard)
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @UseGuards(AuthAdminGuard)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get('me')
  me(@Req() req: any) {
    const cpf = req?.user?.cpf;
    return this.usersService.getMeByCpf(cpf);
  }

  @Patch('me')
  updateMe(@Req() req: any, @Body() dto: UpdateMeDto) {
    const cpf = req?.user?.cpf;
    return this.usersService.updateMeByCpf(cpf, dto);
  }

  @Post('me/trial')
  startTrial(@Req() req: any) {
    const cpf = req?.user?.cpf;
    return this.usersService.startTrialByCpf(cpf);
  }

  @Post('me/change-password')
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    const cpf = req?.user?.cpf;
    return this.usersService.changePasswordByCpf(cpf, dto);
  }

  @Get('me/stats')
  meStats(@Req() req: any) {
    const cpf = req?.user?.cpf;
    return this.usersService.getStatsByCpf(cpf);
  }

  @Get('me/usage')
  meUsage(@Req() req: any) {
    const cpf = req?.user?.cpf;
    return this.usersService.getUsageByCpf(cpf);
  }

  @Get('me/invoices')
  meInvoices(@Req() req: any) {
    const cpf = req?.user?.cpf;
    return this.usersService.getInvoicesByCpf(cpf);
  }

  @Patch('me/deactivate')
  deactivateMe(@Req() req: any) {
    const cpf = req?.user?.cpf;
    return this.usersService.deactivateMeByCpf(cpf);
  }

  @Delete('me')
  deleteMe(@Req() req: any) {
    const cpf = req?.user?.cpf;
    return this.usersService.deleteMeByCpf(cpf);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  @UseGuards(AuthAdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @UseGuards(AuthAdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }
}
