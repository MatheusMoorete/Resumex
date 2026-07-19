import type { RefObject } from 'react';
import pdfIcon from '../../assets/pdf_icon.png';
import FicharioAction from './FicharioAction';

type FicharioPdfDropzoneProps = {
  variant: 'summary' | 'quiz';
  inputRef: RefObject<HTMLInputElement | null>;
  title: string;
  description: string;
  actionLabel?: string;
  ariaLabel: string;
  inputId?: string;
  isDragOver?: boolean;
  isFull?: boolean;
  disabled?: boolean;
  onFilesSelected: (files: FileList) => void;
  onDragStateChange?: (isDragging: boolean) => void;
};

export default function FicharioPdfDropzone({
  variant,
  inputRef,
  title,
  description,
  actionLabel = 'Escolher arquivos',
  ariaLabel,
  inputId,
  isDragOver = false,
  isFull = false,
  disabled = false,
  onFilesSelected,
  onDragStateChange,
}: FicharioPdfDropzoneProps) {
  const isSummary = variant === 'summary';
  const openPicker = () => {
    if (!disabled && !isFull) inputRef.current?.click();
  };

  return (
    <div
      className={`${isSummary ? 'upload-dropzone' : 'quiz-dropzone'} ${isDragOver ? 'drag-over' : ''} ${isFull ? 'is-full' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') openPicker();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDragStateChange?.(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDragStateChange?.(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDragStateChange?.(false);
        if (!disabled && !isFull && event.dataTransfer.files.length) onFilesSelected(event.dataTransfer.files);
      }}
    >
      <img className={`${isSummary ? 'upload-file-mark' : 'upload-icon'} pdf-upload-asset`} src={pdfIcon} alt="" aria-hidden="true" />
      {isSummary ? (
        <div>
          <p className="upload-text">{title}</p>
          <p className="upload-hint">{description}</p>
        </div>
      ) : (
        <>
          <strong>{title}</strong>
          <span>{description}</span>
        </>
      )}
      <FicharioAction className={isSummary ? 'upload-add-label' : 'quiz-dropzone-action'}>{actionLabel}</FicharioAction>
      <input
        ref={inputRef}
        className="upload-input"
        id={inputId}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        onChange={(event) => {
          if (event.target.files?.length) onFilesSelected(event.target.files);
        }}
      />
    </div>
  );
}
