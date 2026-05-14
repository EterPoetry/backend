import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PostStatus } from '../common/enums/post-status.enum';
import { FileStorageService } from '../storage/file-storage.service';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { Post } from '../posts/entities/post.entity';
import { CommentReaction } from '../reactions/entities/comment-reaction.entity';
import { PostComment } from './entities/post-comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { GetPostCommentsQueryDto } from './dto/get-post-comments-query.dto';

export interface CommentAuthorResponse {
  userId: number;
  name: string;
  username: string;
  photo: string | null;
  isPremium: boolean;
}

export interface CommentResponse {
  commentId: number;
  postId: number;
  commentText: string;
  replyToCommentId: number | null;
  repliesCount: number;
  likesCount: number;
  isLiked: boolean;
  author: CommentAuthorResponse;
}

export interface PaginatedCommentsResponse {
  items: CommentResponse[];
  total: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(PostComment)
    private readonly commentsRepository: Repository<PostComment>,
    @InjectRepository(CommentReaction)
    private readonly commentReactionsRepository: Repository<CommentReaction>,
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async getPostComments(
    postId: number,
    requesterUserId: number | null,
    query: GetPostCommentsQueryDto,
  ): Promise<PaginatedCommentsResponse> {
    await this.requirePublishedPost(postId);

    const total = await this.commentsRepository.count({
      where: {
        postId,
        replyToCommentId: IsNull(),
      },
    });

    const queryBuilder = this.createTopLevelCommentsQuery(postId, requesterUserId)
      .andWhere('comment.reply_to_comment_id IS NULL')
      .orderBy('comment.post_comment_id', 'DESC');

    const cursorCommentId = this.parseNumericCursor(query.cursor);
    if (cursorCommentId !== null) {
      queryBuilder.andWhere('comment.post_comment_id < :cursorCommentId', { cursorCommentId });
    }

    const rows = await queryBuilder.limit(query.limit + 1).getRawMany<CommentRow>();
    const { pageRows, nextCursor, hasMore } = this.buildCommentsPage(rows, query.limit);

    return {
      items: pageRows.map((row) => this.mapCommentRow(row)),
      total,
      limit: query.limit,
      nextCursor,
      hasMore,
    };
  }

  async getCommentReplies(
    commentId: number,
    requesterUserId: number | null,
    query: GetPostCommentsQueryDto,
  ): Promise<PaginatedCommentsResponse> {
    const parentComment = await this.requireCommentOnPublishedPost(commentId);

    if (parentComment.replyToCommentId !== null) {
      throw new BadRequestException('Replies can only be requested for top-level comments.');
    }

    const total = await this.commentsRepository.count({
      where: {
        replyToCommentId: parentComment.postCommentId,
      },
    });

    const queryBuilder = this.createCommentsBaseQuery(parentComment.postId, requesterUserId)
      .andWhere('comment.reply_to_comment_id = :commentId', { commentId: parentComment.postCommentId })
      .orderBy('comment.post_comment_id', 'ASC');

    const cursorCommentId = this.parseNumericCursor(query.cursor);
    if (cursorCommentId !== null) {
      queryBuilder.andWhere('comment.post_comment_id > :cursorCommentId', { cursorCommentId });
    }

    const rows = await queryBuilder.limit(query.limit + 1).getRawMany<CommentRow>();
    const { pageRows, nextCursor, hasMore } = this.buildCommentsPage(rows, query.limit);

    return {
      items: pageRows.map((row) => this.mapCommentRow(row)),
      total,
      limit: query.limit,
      nextCursor,
      hasMore,
    };
  }

  async createComment(
    postId: number,
    requesterUserId: number,
    dto: CreateCommentDto,
  ): Promise<CommentResponse> {
    await this.requirePublishedPost(postId);
    const trimmedCommentText = dto.commentText.trim();

    if (!trimmedCommentText) {
      throw new BadRequestException('Comment text cannot be empty.');
    }

    let replyToCommentId: number | null = null;
    if (dto.replyToCommentId !== undefined) {
      const parentComment = await this.commentsRepository.findOne({
        where: { postCommentId: dto.replyToCommentId, postId },
      });

      if (!parentComment) {
        throw new NotFoundException('Parent comment not found.');
      }

      if (parentComment.replyToCommentId !== null) {
        throw new BadRequestException('Only one level of comment replies is allowed.');
      }

      replyToCommentId = parentComment.postCommentId;
    }

    const comment = await this.commentsRepository.save(
      this.commentsRepository.create({
        postId,
        commentAuthorId: requesterUserId,
        commentText: trimmedCommentText,
        replyToCommentId,
      }),
    );

    const row = await this.createCommentsBaseQuery(postId, requesterUserId)
      .andWhere('comment.post_comment_id = :commentId', { commentId: comment.postCommentId })
      .getRawOne<CommentRow>();

    if (!row) {
      throw new NotFoundException('Comment not found.');
    }

    return this.mapCommentRow(row);
  }

  async likeComment(commentId: number, requesterUserId: number): Promise<{ ok: true }> {
    const comment = await this.requireCommentOnPublishedPost(commentId);

    const alreadyLiked = await this.commentReactionsRepository.exist({
      where: {
        postCommentId: comment.postCommentId,
        userId: requesterUserId,
      },
    });

    if (!alreadyLiked) {
      await this.commentReactionsRepository.save(
        this.commentReactionsRepository.create({
          postCommentId: comment.postCommentId,
          userId: requesterUserId,
        }),
      );
    }

    return { ok: true };
  }

  async unlikeComment(commentId: number, requesterUserId: number): Promise<{ ok: true }> {
    const comment = await this.requireCommentOnPublishedPost(commentId);

    await this.commentReactionsRepository.delete({
      postCommentId: comment.postCommentId,
      userId: requesterUserId,
    });

    return { ok: true };
  }

  async deleteComment(commentId: number, requesterUserId: number): Promise<{ ok: true }> {
    const comment = await this.commentsRepository
      .createQueryBuilder('comment')
      .innerJoinAndSelect('comment.post', 'post')
      .where('comment.post_comment_id = :commentId', { commentId })
      .andWhere('post.status = :status', { status: PostStatus.PUBLISHED })
      .getOne();

    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }

    const canDelete =
      comment.commentAuthorId === requesterUserId || comment.post.authorId === requesterUserId;

    if (!canDelete) {
      throw new BadRequestException('You cannot delete this comment.');
    }

    await this.commentsRepository.delete([
      { postCommentId: comment.postCommentId },
      { replyToCommentId: comment.postCommentId },
    ]);

    return { ok: true };
  }

  private createCommentsBaseQuery(postId: number, requesterUserId: number | null) {
    return this.commentsRepository
      .createQueryBuilder('comment')
      .innerJoin('comment.commentAuthor', 'author')
      .leftJoin('author.subscription', 'authorSubscription')
      .leftJoin(
        CommentReaction,
        'requesterReaction',
        'requesterReaction.post_comment_id = comment.post_comment_id AND requesterReaction.user_id = :requesterUserId',
        { requesterUserId },
      )
      .where('comment.post_id = :postId', { postId })
      .select([
        'comment.post_comment_id AS comment_id',
        'comment.post_id AS post_id',
        'comment.comment_text AS comment_text',
        'comment.reply_to_comment_id AS reply_to_comment_id',
        'author.user_id AS author_user_id',
        'author.name AS author_name',
        'author.username AS author_username',
        'author.photo AS author_photo',
        'authorSubscription.status AS author_subscription_status',
        'requesterReaction.comment_reaction_id AS requester_reaction_id',
      ])
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(reaction.comment_reaction_id)')
          .from(CommentReaction, 'reaction')
          .where('reaction.post_comment_id = comment.post_comment_id');
      }, 'likes_count');
  }

  private createTopLevelCommentsQuery(postId: number, requesterUserId: number | null) {
    return this.createCommentsBaseQuery(postId, requesterUserId).addSelect((subQuery) => {
      return subQuery
        .select('COUNT(reply.post_comment_id)')
        .from(PostComment, 'reply')
        .where('reply.reply_to_comment_id = comment.post_comment_id');
    }, 'replies_count');
  }

  private buildCommentsPage(rows: CommentRow[], limit: number) {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);

    return {
      pageRows,
      hasMore,
      nextCursor: hasMore && lastRow ? String(lastRow.comment_id) : null,
    };
  }

  private parseNumericCursor(cursor?: string): number | null {
    if (!cursor) {
      return null;
    }

    const value = Number(cursor);
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException('Cursor must be a positive integer.');
    }

    return value;
  }

  private mapCommentRow(row: CommentRow): CommentResponse {
    return {
      commentId: Number(row.comment_id),
      postId: Number(row.post_id),
      commentText: row.comment_text,
      replyToCommentId:
        row.reply_to_comment_id === null || row.reply_to_comment_id === undefined
          ? null
          : Number(row.reply_to_comment_id),
      repliesCount: Number(row.replies_count ?? 0),
      likesCount: Number(row.likes_count ?? 0),
      isLiked: row.requester_reaction_id !== null && row.requester_reaction_id !== undefined,
      author: {
        userId: Number(row.author_user_id),
        name: row.author_name,
        username: row.author_username,
        photo: this.fileStorageService.getFileUrl(row.author_photo),
        isPremium: row.author_subscription_status === SubscriptionStatus.ACTIVE,
      },
    };
  }

  private async requirePublishedPost(postId: number): Promise<Post> {
    const post = await this.postsRepository.findOne({
      where: {
        postId,
        status: PostStatus.PUBLISHED,
      },
    });

    if (!post) {
      throw new NotFoundException('Published post not found.');
    }

    return post;
  }

  private async requireCommentOnPublishedPost(commentId: number): Promise<PostComment> {
    const comment = await this.commentsRepository
      .createQueryBuilder('comment')
      .innerJoin('comment.post', 'post')
      .where('comment.post_comment_id = :commentId', { commentId })
      .andWhere('post.status = :status', { status: PostStatus.PUBLISHED })
      .getOne();

    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }

    return comment;
  }
}

interface CommentRow {
  comment_id: number | string;
  post_id: number | string;
  comment_text: string;
  reply_to_comment_id: number | string | null;
  replies_count?: number | string | null;
  likes_count: number | string;
  requester_reaction_id: number | string | null;
  author_user_id: number | string;
  author_name: string;
  author_username: string;
  author_photo: string | null;
  author_subscription_status: SubscriptionStatus | null;
}
