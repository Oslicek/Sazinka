import { useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CharacterCount from '@tiptap/extension-character-count';
import { useTranslation } from 'react-i18next';
import type { NoteEntityType } from '@shared/note';
import styles from './NoteEditor.module.css';

const MAX_CHARS = 10_000;

export interface NoteEditorProps {
  entityType: NoteEntityType;
  entityId: string;
  initialContent: string;
  readOnly?: boolean;
  onSave?: (markdown: string) => Promise<void>;
  onChange?: (markdown: string) => void;
}

function htmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<h([1-3])[^>]*>(.*?)<\/h[1-3]>/gi, (_, level, content) =>
    '#'.repeat(Number(level)) + ' ' + content.replace(/<[^>]+>/g, '') + '\n\n',
  );
  md = md.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i>(.*?)<\/i>/gi, '*$1*');
  md = md.replace(/<s>(.*?)<\/s>/gi, '~~$1~~');
  md = md.replace(/<code>(.*?)<\/code>/gi, '`$1`');
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) =>
    content.replace(/<p[^>]*>(.*?)<\/p>/gi, '> $1\n').replace(/<[^>]+>/g, ''),
  );
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) =>
    content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n').replace(/<[^>]+>/g, ''),
  );
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let i = 1;
    return content
      .replace(/<li[^>]*>(.*?)<\/li>/gi, (_m: string, li: string) => `${i++}. ${li}\n`)
      .replace(/<[^>]+>/g, '');
  });
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<[^>]+>/g, '');
  md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

function markdownToHtml(md: string): string {
  if (!md) return '';
  let html = md;
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\n/g, '<br/>');
  return html;
}

export function NoteEditor({
  entityType,
  entityId,
  initialContent,
  readOnly = false,
  onSave,
  onChange,
}: NoteEditorProps) {
  const { t } = useTranslation('common');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      CharacterCount.configure({ limit: MAX_CHARS }),
    ],
    content: markdownToHtml(initialContent),
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      const md = htmlToMarkdown(ed.getHTML());
      onChange?.(md);
    },
  });

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  // Reset content when entity changes
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      const currentMd = htmlToMarkdown(editor.getHTML());
      if (currentMd !== initialContent) {
        editor.commands.setContent(markdownToHtml(initialContent));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const handleSave = useCallback(async () => {
    if (!editor || !onSave) return;
    const md = htmlToMarkdown(editor.getHTML());
    await onSave(md);
  }, [editor, onSave]);

  const charCount = editor?.storage.characterCount?.characters() ?? 0;

  return (
    <div className={styles.container} data-testid="note-editor">
      {!readOnly && (
        <div className={styles.toolbar}>
          <button
            type="button"
            data-testid="toolbar-bold"
            className={`${styles.toolbarBtn} ${editor?.isActive('bold') ? styles.active : ''}`}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            title={t('editor_bold', 'Bold')}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            data-testid="toolbar-italic"
            className={`${styles.toolbarBtn} ${editor?.isActive('italic') ? styles.active : ''}`}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            title={t('editor_italic', 'Italic')}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            data-testid="toolbar-heading"
            className={`${styles.toolbarBtn} ${editor?.isActive('heading', { level: 2 }) ? styles.active : ''}`}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            title={t('editor_heading', 'Heading')}
          >
            H
          </button>
          <button
            type="button"
            data-testid="toolbar-bullet-list"
            className={`${styles.toolbarBtn} ${editor?.isActive('bulletList') ? styles.active : ''}`}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            title={t('editor_bullet_list', 'Bullet list')}
          >
            •
          </button>
          <button
            type="button"
            data-testid="toolbar-ordered-list"
            className={`${styles.toolbarBtn} ${editor?.isActive('orderedList') ? styles.active : ''}`}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            title={t('editor_ordered_list', 'Numbered list')}
          >
            1.
          </button>
          <button
            type="button"
            data-testid="toolbar-blockquote"
            className={`${styles.toolbarBtn} ${editor?.isActive('blockquote') ? styles.active : ''}`}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            title={t('editor_blockquote', 'Quote')}
          >
            "
          </button>
          <button
            type="button"
            data-testid="toolbar-code"
            className={`${styles.toolbarBtn} ${editor?.isActive('code') ? styles.active : ''}`}
            onClick={() => editor?.chain().focus().toggleCode().run()}
            title={t('editor_code', 'Code')}
          >
            {'</>'}
          </button>

          <div className={styles.toolbarSpacer} />

          {onSave && (
            <button
              type="button"
              data-testid="save-btn"
              className={styles.saveBtn}
              onClick={handleSave}
            >
              {t('save', 'Save')}
            </button>
          )}
        </div>
      )}

      <EditorContent editor={editor} className={readOnly ? styles.editorReadOnly : styles.editor} />

      {!readOnly && (
        <div className={styles.footer} data-testid="char-count">
          <span className={charCount >= MAX_CHARS ? styles.charCountOver : styles.charCount}>
            {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}
