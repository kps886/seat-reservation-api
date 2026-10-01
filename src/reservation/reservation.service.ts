import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ReservationService {
  constructor(private prisma: PrismaService) {}

  // --- NEW: Create a show and populate available seats ---
  async createShow(name: string, price_paise: number, seatNumbers: string[]) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Create the Show
      const show = await tx.show.create({
        data: {
          name,
          price_paise,
          total_seats: seatNumbers.length,
        }
      });

      // 2. Bulk insert all seats as 'available'
      const seatData = seatNumbers.map(seat_number => ({
        showId: show.id,
        seat_number,
        status: 'available'
      }));

      await tx.seat.createMany({ data: seatData });

      return {
        id: show.id,
        name: show.name,
        price_paise: show.price_paise,
        total_seats: show.total_seats,
        seats: seatNumbers
      };
    });
  }

  // --- NEW: Get show state (Proves Reconciliation Invariant) ---
  async getShow(showId: string) {
    const seats = await this.prisma.seat.findMany({
      where: { showId }
    });

    const counts = { available: 0, held: 0, confirmed: 0 };
    seats.forEach(seat => {
      if (counts[seat.status as keyof typeof counts] !== undefined) {
        counts[seat.status as keyof typeof counts]++;
      }
    });

    return {
      show_id: showId,
      total_seats: seats.length,
      available: counts.available,
      held: counts.held,
      confirmed: counts.confirmed,
      seats: seats.map(s => ({ seat_number: s.seat_number, status: s.status }))
    };
  }

  // --- EXISTING: The Atomic Reservation Logic ---
  async reserveSeats(showId: string, requestedSeats: string[], userId: string, idempotencyKey: string) {
    // 1. Check Idempotency upfront outside the main seat-lock transaction
    if (idempotencyKey) {
      const existing = await this.prisma.reservation.findUnique({
        where: { idempotency_key: idempotencyKey },
      });
      if (existing) {
        const seatsMatch = existing.seat_numbers.sort().join(',') === [...requestedSeats].sort().join(',');
        if (!seatsMatch) {
          throw new HttpException('Conflict: Idempotency key reused for different seats', HttpStatus.CONFLICT);
        }
        return existing; // Clean return of original reservation on retry!
      }
    }

    // 2. Check Per-User Limit (Max 4)
    const userCurrentSeats = await this.prisma.seat.count({
      where: { showId, userId, status: { in: ['held', 'confirmed'] } }
    });

    if (userCurrentSeats + requestedSeats.length > 4) {
      throw new HttpException('Conflict: Per-user limit exceeded', HttpStatus.CONFLICT);
    }

    // 3. Atomic Transaction & Deterministic Lock
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sortedSeats = [...requestedSeats].sort();

        const lockedSeats = await tx.$queryRaw<any[]>`
          SELECT * FROM "Seat"
          WHERE "showId" = ${showId} 
          AND "seat_number" = ANY(${sortedSeats}::text[])
          ORDER BY "seat_number"
          FOR UPDATE;
        `;

        const allAvailable = lockedSeats.length === sortedSeats.length && 
                             lockedSeats.every(seat => seat.status === 'available');

        if (!allAvailable) {
          throw new HttpException('Conflict: One or more seats are already taken', HttpStatus.CONFLICT);
        }

        await tx.$executeRaw`
          UPDATE "Seat" 
          SET status = 'confirmed', "userId" = ${userId}
          WHERE "showId" = ${showId} AND "seat_number" = ANY(${sortedSeats}::text[]);
        `;

        // Handle possible parallel race on unique idempotency constraint safely
        try {
          return await tx.reservation.create({
            data: {
              idempotency_key: idempotencyKey || `auto_${Date.now()}_${Math.random()}`,
              userId: userId,
              seat_numbers: requestedSeats,
              status: 'confirmed',
            },
          });
        } catch (dbErr) {
          // If a parallel request already inserted this key, fetch and return it
          const fallback = await tx.reservation.findUnique({
            where: { idempotency_key: idempotencyKey }
          });
          if (fallback) return fallback;
          throw dbErr;
        }
      }, { timeout: 10000 }); // Increase transaction timeout to 10s under heavy load
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException('Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}