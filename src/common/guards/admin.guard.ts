import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";
import { Observable } from "rxjs";

@Injectable()
export class AuthAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const role = (request['user']?.role ?? '').toString().toUpperCase();
    if (role === 'ADMIN') return true;
    throw new ForbiddenException('Acesso restrito a administradores');
  }
}
