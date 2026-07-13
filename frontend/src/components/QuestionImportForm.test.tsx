// frontend/src/components/QuestionImportForm.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuestionImportForm } from './QuestionImportForm';
import * as authContext from '../context/AuthContext';
import * as adminApi from '../api/admin';

describe('QuestionImportForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok',
      user: { id: 1, telegramId: 9999 } as any,
      loading: false,
      error: null,
    });
  });

  it('has no category selection UI', () => {
    render(<QuestionImportForm />);
    expect(screen.queryByLabelText('Turkum')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Yangi turkum nomi')).not.toBeInTheDocument();
    expect(screen.queryByText('+ Yangi turkum')).not.toBeInTheDocument();
  });

  it('disables the upload button until a file is chosen', () => {
    render(<QuestionImportForm />);
    expect(screen.getByRole('button', { name: 'Yuklash' })).toBeDisabled();
  });

  it('uploads the file, always targeting the ingliz_tili category', async () => {
    const importSpy = vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'ingliz_tili', label: 'Ingliz tili' },
      inserted: 5,
      errors: [],
    });

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await waitFor(() => expect(importSpy).toHaveBeenCalledOnce());
    const [formData, token] = importSpy.mock.calls[0];
    expect(token).toBe('tok');
    expect(formData.get('file')).toBe(file);
    expect(formData.get('category')).toBe('ingliz_tili');
    expect(formData.get('newCategoryLabel')).toBeNull();

    await screen.findByText(/5 ta savol qo'shildi/);
  });

  it('shows the list of per-line errors returned alongside a successful import', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'ingliz_tili', label: 'Ingliz tili' },
      inserted: 1,
      errors: [{ line: 5, message: "to'g'ri javob belgilanmagan" }],
    });

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText(/5-qatorda: to'g'ri javob belgilanmagan/);
  });

  it('shows an error message when the upload fails', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockRejectedValue(new Error('Bunday turkum topilmadi'));

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText('Bunday turkum topilmadi');
  });

  it('disables the file input while uploading', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockReturnValue(new Promise(() => {}));

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await waitFor(() => expect(screen.getByLabelText('Fayl')).toBeDisabled());
  });

  it('resets the file input after a successful upload', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'ingliz_tili', label: 'Ingliz tili' },
      inserted: 5,
      errors: [],
    });

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText(/5 ta savol qo'shildi/);

    expect((screen.getByLabelText('Fayl') as HTMLInputElement).value).toBeFalsy();
  });
});
