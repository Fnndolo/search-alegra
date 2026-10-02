import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { BillEditCaseService } from './bill-edit-case.service';
import { GoogleChatClient } from './google-chat.client';
import { BillEditCase } from '../entities/bill-edit-case.entity';
import { BillEditAudit } from '../entities/bill-edit-audit.entity';
import { Bill } from '../entities/bill.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BillEditCase, BillEditAudit, Bill])],
  controllers: [ChatController],
  providers: [BillEditCaseService, GoogleChatClient],
  exports: [BillEditCaseService, GoogleChatClient],
})
export class ChatModule {}
