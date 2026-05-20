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
import { NotificationResponse } from './notifications.service';

interface NotificationsSocketData {
  userId?: number;
  email?: string;
}

interface SocketHandshakeAuth {
  token?: string;
}

interface NotificationsJwtPayload {
  sub: number;
  email?: string;
  type: 'access';
}

export interface NotificationReceivedPayload {
  notification: NotificationResponse;
  unreadCount: number;
  unseenCount: number;
}

export interface CountsUpdatedPayload {
  unreadCount: number;
  unseenCount: number;
}

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
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
    } catch {
      this.logger.warn(`Rejected notifications socket connection: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = (client.data as NotificationsSocketData).userId;
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

  @SubscribeMessage('notifications:ping')
  handlePing(@ConnectedSocket() client: Socket): { ok: true } {
    const userId = (client.data as NotificationsSocketData).userId;
    if (!userId) {
      client.disconnect(true);
    }

    return { ok: true };
  }

  @SubscribeMessage('notifications:subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() _payload?: Record<string, unknown>,
  ): { ok: true } {
    const userId = (client.data as NotificationsSocketData).userId;
    if (!userId) {
      client.disconnect(true);
    }

    return { ok: true };
  }

  emitNotificationReceived(userId: number, payload: NotificationReceivedPayload): void {
    this.server.to(this.getUserRoom(userId)).emit('notification_received', payload);
  }

  emitCountsUpdated(userId: number, payload: CountsUpdatedPayload): void {
    this.server.to(this.getUserRoom(userId)).emit('counts_updated', payload);
  }

  private verifyAccessToken(client: Socket): NotificationsJwtPayload {
    const token = this.extractToken(client);
    if (!token) {
      throw new Error('Missing notifications socket token.');
    }

    const secret = this.configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret');
    const payload = this.jwtService.verify<NotificationsJwtPayload>(token, { secret });
    if (payload.type !== 'access') {
      throw new Error('Invalid notifications socket token type.');
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
    return `notifications:user:${userId}`;
  }
}
