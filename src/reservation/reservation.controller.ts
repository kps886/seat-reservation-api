import { Controller, Get, Post, Param, Body, Headers, HttpCode } from '@nestjs/common';
import { ReservationService } from './reservation.service.js';

@Controller('shows')
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  // --- NEW: Create a show ---
  @Post()
  @HttpCode(201)
  async createShow(@Body() body: { name: string; seats: string[]; price_paise: number }) {
    return this.reservationService.createShow(body.name, body.price_paise, body.seats);
  }

  // --- NEW: Get show state ---
  @Get(':id')
  async getShow(@Param('id') showId: string) {
    return this.reservationService.getShow(showId);
  }

  // --- EXISTING: Reserve a seat ---
  @Post(':id/reserve')
  @HttpCode(201)
  async reserve(
    @Param('id') showId: string,
    @Body() body: { seats: string[] },
    @Headers('authorization') authHeader: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const userId = authHeader?.replace('Bearer ', '') || 'anonymous';
    const key = idempotencyKey || (body as any).idempotency_key;

    const reservation = await this.reservationService.reserveSeats(
      showId,
      body.seats,
      userId,
      key
    );

    return {
      reservation_id: reservation.id,
      show_id: showId,
      user_id: userId,
      seats: reservation.seat_numbers,
      amount_paise: 25000 * reservation.seat_numbers.length,
      status: reservation.status,
    };
  }
}