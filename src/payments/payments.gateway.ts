import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { CheckoutSubscriptionResponseDto } from './dto/checkout-subscription.dto';
import {
  SubscriptionCardResponse,
  SubscriptionResponse,
  SubscriptionTransactionResponse,
} from './payments.service';

interface PaymentsSocketData {
  userId?: number;
  email?: string;
}

interface SocketHandshakeAuth {
  token?: string;
}

interface PaymentsJwtPayload {
  sub: number;
  email?: string;
  type: 'access';
}

@WebSocketGateway({
  namespace: '/payments',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class PaymentsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PaymentsGateway.name);
  private readonly socketsByUserId = new Map<number, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  handleConnection(client: Socket): void {
    try {
      const payload = this.verifyAccessToken(client);
      client.data.userId = payload.sub;
      client.data.email = payload.email;
      this.trackSocket(payload.sub, client.id);
      void client.join(this.getUserRoom(payload.sub));
    } catch (error) {
      this.logger.warn(`Rejected payments socket connection: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = (client.data as PaymentsSocketData).userId;
    if (!userId) {
      return;
    }

    const sockets = this.socketsByUserId.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(client.id);
    if (sockets.size === 0) {
      this.socketsByUserId.delete(userId);
    }
  }

  @SubscribeMessage('payments:ping')
  handlePing(@ConnectedSocket() client: Socket): { ok: true } {
    const userId = (client.data as PaymentsSocketData).userId;
    if (!userId) {
      client.disconnect(true);
    }

    return { ok: true };
  }

  @SubscribeMessage('payments:subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() _payload?: Record<string, unknown>,
  ): { ok: true } {
    const userId = (client.data as PaymentsSocketData).userId;
    if (!userId) {
      client.disconnect(true);
    }

    return { ok: true };
  }

  emitTransactionUpdated(userId: number, transaction: SubscriptionTransactionResponse): void {
    this.server.to(this.getUserRoom(userId)).emit('transaction_updated', transaction);
  }

  emitCardLinked(
    userId: number,
    payload: { card: SubscriptionCardResponse; subscription: SubscriptionResponse },
  ): void {
    this.server.to(this.getUserRoom(userId)).emit('card_linked', payload);
  }

  emitCheckoutCreated(userId: number, payload: CheckoutSubscriptionResponseDto): void {
    this.server.to(this.getUserRoom(userId)).emit('checkout_created', payload);
  }

  private verifyAccessToken(client: Socket): PaymentsJwtPayload {
    const token = this.extractToken(client);
    if (!token) {
      throw new Error('Missing payments socket token.');
    }

    const secret = this.configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret');
    const payload = this.jwtService.verify<PaymentsJwtPayload>(token, { secret });
    if (payload.type !== 'access') {
      throw new Error('Invalid payments socket token type.');
    }

    return payload;
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as SocketHandshakeAuth | undefined;
    if (auth?.token?.trim()) {
      return auth.token.trim();
    }

    const authorizationHeader = client.handshake.headers.authorization;
    if (typeof authorizationHeader === 'string' && authorizationHeader.startsWith('Bearer ')) {
      return authorizationHeader.slice('Bearer '.length).trim();
    }

    const queryToken = client.handshake.query.token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.trim();
    }

    return null;
  }

  private trackSocket(userId: number, socketId: string): void {
    const sockets = this.socketsByUserId.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.socketsByUserId.set(userId, sockets);
  }

  private getUserRoom(userId: number): string {
    return `payments:user:${userId}`;
  }
}
