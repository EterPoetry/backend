import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PostCategory } from './post-category.entity';

@Entity({ name: 'categories' })
export class Category {
  @PrimaryGeneratedColumn({ name: 'category_id' })
  categoryId: number;

  @Column({ name: 'category_name', type: 'varchar', length: 120, unique: true })
  categoryName: string;

  @Column({ name: 'category_description', type: 'text', nullable: true })
  categoryDescription: string | null;

  @OneToMany(() => PostCategory, (postCategory) => postCategory.category)
  postCategories: PostCategory[];
}
