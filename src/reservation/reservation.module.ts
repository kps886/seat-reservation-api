import { Module } from '@nestjs/common';
import { ReservationService } from './reservation.service.js';
import { ReservationController } from './reservation.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  controllers: [ReservationController],
  providers: [ReservationService, PrismaService],
})
export class ReservationModule {}