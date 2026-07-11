// frontend/src/components/QuestionImportForm.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuestionImportForm } from './QuestionImportForm';
import * as authContext from '../context/AuthContext';
import * as questionsApi from '../api/questions';
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
    vi.spyOn(questionsApi, 'getCategories').mockResolvedValue({
      categories: [
        { key: 'umumiy_bilim', label: 'Umumiy bilim' },
        { key: 'sport_kino_musiqa', label: 'Sport/Kino/Musiqa' },
      ],
    });
  });

  it('shows a loading state and withholds the form until categories are fetched', async () => {
    // Regression: the select used to render immediately with an empty
    // options list, then silently repopulate once getCategories() resolved
    // - a visible "pop-in" moment. Now the whole form waits behind one
    // loading state so it appears fully-formed in a single step.
    let resolveCategories: (value: { categories: { key: string; label: string }[] }) => void;
    vi.spyOn(questionsApi, 'getCategories').mockReturnValue(
      new Promise((resolve) => { resolveCategories = resolve; })
    );

    render(<QuestionImportForm />);

    expect(screen.getByText(/Yuklanmoqda/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Turkum')).not.toBeInTheDocument();

    resolveCategories!({ categories: [{ key: 'umumiy_bilim', label: 'Umumiy bilim' }] });

    await screen.findByLabelText('Turkum');
    expect(screen.queryByText(/Yuklanmoqda/)).not.toBeInTheDocument();
  });

  it('loads and shows the existing categories plus a "new category" option', async () => {
    render(<QuestionImportForm />);

    await screen.findByText('Umumiy bilim');
    expect(screen.getByText('Sport/Kino/Musiqa')).toBeInTheDocument();
    expect(screen.getByText('+ Yangi turkum')).toBeInTheDocument();
  });

  it('shows a text field for the new category name only when "+ Yangi turkum" is selected', async () => {
    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    expect(screen.queryByLabelText('Yangi turkum nomi')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Turkum'), { target: { value: '__new__' } });

    expect(screen.getByLabelText('Yangi turkum nomi')).toBeInTheDocument();
  });

  it('disables the upload button until a file is chosen', async () => {
    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    expect(screen.getByRole('button', { name: 'Yuklash' })).toBeDisabled();
  });

  it('uploads the file with the selected category and shows the result', async () => {
    const importSpy = vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'umumiy_bilim', label: 'Umumiy bilim' },
      inserted: 5,
      errors: [],
    });

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await waitFor(() => expect(importSpy).toHaveBeenCalledOnce());
    const [formData, token] = importSpy.mock.calls[0];
    expect(token).toBe('tok');
    expect(formData.get('file')).toBe(file);
    expect(formData.get('category')).toBe('umumiy_bilim');
    expect(formData.get('newCategoryLabel')).toBeNull();

    await screen.findByText(/5 ta savol qo'shildi/);
  });

  it('uploads with newCategoryLabel when the "new category" option is used', async () => {
    const importSpy = vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'tarix', label: 'Tarix' },
      inserted: 2,
      errors: [],
    });

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    fireEvent.change(screen.getByLabelText('Turkum'), { target: { value: '__new__' } });
    fireEvent.change(screen.getByLabelText('Yangi turkum nomi'), { target: { value: 'Tarix' } });
    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await waitFor(() => expect(importSpy).toHaveBeenCalledOnce());
    const [formData] = importSpy.mock.calls[0];
    expect(formData.get('newCategoryLabel')).toBe('Tarix');
    expect(formData.get('category')).toBeNull();

    await screen.findByText(/2 ta savol qo'shildi/);
  });

  it('shows the list of per-line errors returned alongside a successful import', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'umumiy_bilim', label: 'Umumiy bilim' },
      inserted: 1,
      errors: [{ line: 5, message: "to'g'ri javob belgilanmagan" }],
    });

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText(/5-qatorda: to'g'ri javob belgilanmagan/);
  });

  it('shows an error message when the upload fails', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockRejectedValue(new Error('Bunday turkum topilmadi'));

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText('Bunday turkum topilmadi');
  });

  it('disables the category select, new-category input and file input while uploading', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockReturnValue(new Promise(() => {}));

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    fireEvent.change(screen.getByLabelText('Turkum'), { target: { value: '__new__' } });
    fireEvent.change(screen.getByLabelText('Yangi turkum nomi'), { target: { value: 'Tarix' } });
    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await waitFor(() => expect(screen.getByLabelText('Turkum')).toBeDisabled());
    expect(screen.getByLabelText('Yangi turkum nomi')).toBeDisabled();
    expect(screen.getByLabelText('Fayl')).toBeDisabled();
  });

  it('resets the file input after a successful upload', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'umumiy_bilim', label: 'Umumiy bilim' },
      inserted: 5,
      errors: [],
    });

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText(/5 ta savol qo'shildi/);

    expect((screen.getByLabelText('Fayl') as HTMLInputElement).value).toBeFalsy();
  });
});
