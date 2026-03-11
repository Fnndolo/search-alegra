import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async onModuleInit() {
    await this.seedAdmin();
  }

  async seedAdmin() {
    const admin = await this.usersRepository.findOne({ where: { role: UserRole.ADMIN } });
    if (!admin) {
      const hashedPassword = await bcrypt.hash('Admin123!', 10);
      const newAdmin = this.usersRepository.create({
        username: 'admin',
        password: hashedPassword,
        email: 'admin@smartgadgets.com',
        role: UserRole.ADMIN,
      });
      await this.usersRepository.save(newAdmin);
      console.log('✅ Initial admin user created');
    }
  }

  async findOne(username: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { username } });
  }

  async findById(id: number): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      select: ['id', 'username', 'email', 'role', 'status', 'createdAt'],
    });
  }

  async create(userData: Partial<User>): Promise<User> {
    if (userData.password) {
      userData.password = await bcrypt.hash(userData.password, 10);
    }
    const user = this.usersRepository.create(userData);
    return this.usersRepository.save(user);
  }

  async update(id: number, userData: Partial<User>): Promise<void> {
    if (userData.password) {
      userData.password = await bcrypt.hash(userData.password, 10);
    }
    await this.usersRepository.update(id, userData);
  }

  async remove(id: number): Promise<void> {
    await this.usersRepository.delete(id);
  }
}
