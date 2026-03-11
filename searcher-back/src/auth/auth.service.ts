import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    console.log(`🔍 Attempting to validate user: ${username}`);
    const user = await this.usersService.findOne(username);
    if (!user) {
      console.log(`❌ User not found: ${username}`);
      return null;
    }

    const isMatch = await bcrypt.compare(pass, user.password);
    console.log(`🔑 Password match for ${username}: ${isMatch}`);

    if (isMatch) {
      if (user.status === 'inactive') {
        console.log(`🚫 User is inactive: ${username}`);
        throw new UnauthorizedException('Su cuenta está desactivada');
      }
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { username: user.username, sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email
      }
    };
  }
}
