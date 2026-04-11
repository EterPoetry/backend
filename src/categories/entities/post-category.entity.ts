import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Post } from '../../posts/entities/post.entity';
import { Category } from './category.entity';

@Entity({ name: 'post_categories' })
@Unique('UQ_post_categories_post_category', ['postId', 'categoryId'])
export class PostCategory {
  @PrimaryGeneratedColumn({ name: 'post_category_id' })
  postCategoryId: number;

  @ManyToOne(() => Post, (post) => post.postCategories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @Column({ name: 'post_id', type: 'integer' })
  postId: number;

  @ManyToOne(() => Category, (category) => category.postCategories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @Column({ name: 'category_id', type: 'integer' })
  categoryId: number;
}
