// frontend/src/components/QuestionImportForm.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getCategories } from '../api/questions';
import { importQuestions } from '../api/admin';
import { Category, QuestionImportResult } from '../api/types';

const NEW_CATEGORY_VALUE = '__new__';

export function QuestionImportForm() {
  const { token } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<QuestionImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories()
      .then((res) => {
        setCategories(res.categories);
        if (res.categories.length > 0) setSelectedCategory(res.categories[0].key);
      })
      .catch(() => {
        // Category dropdown just stays empty - not worth a dedicated error
        // state for this secondary admin widget.
      });
  }, []);

  const isNewCategory = selectedCategory === NEW_CATEGORY_VALUE;
  const canUpload =
    !uploading && file !== null && (isNewCategory ? newCategoryLabel.trim().length > 0 : selectedCategory.length > 0);

  const handleUpload = async () => {
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    if (isNewCategory) {
      formData.append('newCategoryLabel', newCategoryLabel.trim());
    } else {
      formData.append('category', selectedCategory);
    }

    try {
      const res = await importQuestions(formData, token);
      setResult(res);
      if (isNewCategory) {
        setCategories((prev) => [...prev, res.category]);
        setSelectedCategory(res.category.key);
        setNewCategoryLabel('');
      }
      setFile(null);
      setFileInputKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noma'lum xatolik yuz berdi");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
      <h3 className="text-sm font-semibold text-ios-label">Savol qo'shish</h3>

      <select
        aria-label="Turkum"
        value={selectedCategory}
        disabled={uploading}
        onChange={(e) => {
          setSelectedCategory(e.target.value);
          setError(null);
          setResult(null);
        }}
        className="rounded-xl border border-ios-divider bg-ios-bg px-3 py-2 text-sm text-ios-label"
      >
        {categories.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
        <option value={NEW_CATEGORY_VALUE}>+ Yangi turkum</option>
      </select>

      {isNewCategory && (
        <input
          type="text"
          aria-label="Yangi turkum nomi"
          value={newCategoryLabel}
          disabled={uploading}
          onChange={(e) => {
            setNewCategoryLabel(e.target.value);
            setError(null);
            setResult(null);
          }}
          placeholder="Turkum nomi"
          className="rounded-xl border border-ios-divider bg-ios-bg px-3 py-2 text-sm text-ios-label"
        />
      )}

      <input
        key={fileInputKey}
        type="file"
        aria-label="Fayl"
        accept=".docx"
        disabled={uploading}
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setError(null);
          setResult(null);
        }}
      />

      <button
        type="button"
        disabled={!canUpload}
        onClick={handleUpload}
        className="rounded-full bg-ios-blue py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {uploading ? 'Yuklanmoqda...' : 'Yuklash'}
      </button>

      {result && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-ios-green">
            ✅ {result.inserted} ta savol qo'shildi ({result.category.label})
          </p>
          {result.errors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-ios-red">
              {result.errors.map((e, i) => (
                <li key={i}>
                  {e.line}-qatorda: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm text-ios-red">{error}</p>}
    </div>
  );
}
