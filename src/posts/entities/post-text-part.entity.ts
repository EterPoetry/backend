import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Post } from './post.entity';

@Entity({ name: 'post_text_parts' })
@Unique('UQ_post_text_parts_post_line', ['postId', 'lineIndex'])
export class PostTextPart {
  @PrimaryGeneratedColumn({ name: 'post_text_part_id' })
  postTextPartId: number;

  @Column({ name: 'line_index', type: 'integer' })
  lineIndex: number;

  @Column({ name: 'audio_start_moment_ms', type: 'integer' })
  audioStartMomentMs: number;

  @ManyToOne(() => Post, (post) => post.textParts, { onDelete: 'CASCADE' })
  post: Post;

  @Column({ name: 'post_id', type: 'integer' })
  postId: number;
}
