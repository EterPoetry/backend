export enum ComplaintReason {
  COPYRIGHT_INFRINGEMENT = 'copyright_infringement',
  PLAGIARISM = 'plagiarism',
  OFFENSIVE_OR_DISCRIMINATORY_CONTENT = 'offensive_or_discriminatory_content',
  HATE_SPEECH = 'hate_speech',
  TARGETED_HARASSMENT = 'targeted_harassment',
  ADVERTISING_OR_SPAM = 'advertising_or_spam',
  NOT_POETRY = 'not_poetry',
  RUSSIAN_LANGUAGE = 'russian_language',
  PROPAGANDA_OR_PRO_RUSSIAN_CONTENT = 'propaganda_or_pro_russian_content',
  BROKEN_OR_UNPLAYABLE_FILE = 'broken_or_unplayable_file',
  OTHER = 'other',
}

export const COMPLAINT_REASON_LABELS: Record<ComplaintReason, string> = {
  [ComplaintReason.COPYRIGHT_INFRINGEMENT]: 'Порушення авторського права',
  [ComplaintReason.PLAGIARISM]: 'Плагіат',
  [ComplaintReason.OFFENSIVE_OR_DISCRIMINATORY_CONTENT]:
    'Образливий або дискримінаційний зміст',
  [ComplaintReason.HATE_SPEECH]: 'Мова ворожнечі',
  [ComplaintReason.TARGETED_HARASSMENT]: 'Спрямування проти конкретної людини',
  [ComplaintReason.ADVERTISING_OR_SPAM]: 'Реклама або спам',
  [ComplaintReason.NOT_POETRY]: 'Не є поезією',
  [ComplaintReason.RUSSIAN_LANGUAGE]: 'Використання російської мови',
  [ComplaintReason.PROPAGANDA_OR_PRO_RUSSIAN_CONTENT]: 'Пропаганда або проросійський зміст',
  [ComplaintReason.BROKEN_OR_UNPLAYABLE_FILE]: 'Пошкоджений або непридатний для відтворення файл',
  [ComplaintReason.OTHER]: 'Інше',
};
