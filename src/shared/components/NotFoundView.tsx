import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './ErrorPages.css';

export interface NotFoundViewProps {
  /** Custom title/number, defaults to "404" */
  code?: string;
  /** Custom badge text, defaults to "PÁGINA EXTRAVIADA" */
  badgeText?: string;
  /** Custom description in PT-BR */
  description?: string;
  /** Custom action button text */
  buttonText?: string;
  /** Custom click handler for the back button */
  onBack?: () => void;
}

export const NotFoundView: React.FC<NotFoundViewProps> = ({
  code = '404',
  badgeText = 'PÁGINA EXTRAVIADA',
  description = 'O manuscrito que você está procurando foi extraviado nos arquivos ou não existe mais.',
  buttonText = 'VOLTAR AO FICHÁRIO',
  onBack,
}) => {
  const navigate = useNavigate();

  const handleNavigateBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate('/app');
    }
  };

  return (
    <div className="error-page-container">
      <main className="error-card-sheet not-found-error-card" role="main">
        {/* Paperclip graphic top right */}
        <svg 
          className="error-paperclip" 
          viewBox="0 0 34 60" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path 
            d="M12 18V42C12 46.4183 15.5817 50 20 50C24.4183 50 28 46.4183 28 42V14C28 7.37258 22.6274 2 16 2C9.37258 2 4 7.37258 4 14V42" 
            stroke="#203229" 
            strokeWidth="3" 
            strokeLinecap="round"
          />
        </svg>

        {/* Coral Stamp Badge */}
        <div className="error-stamp-badge">
          {badgeText}
        </div>

        {/* 404 Georgia Number */}
        <h1 className="error-404-number">{code}</h1>

        {/* Description in PT-BR */}
        <p className="error-sheet-description">
          {description}
        </p>

        {/* Dark Green Button */}
        <div className="error-actions-group">
          <button
            type="button"
            className="btn-error-green"
            onClick={handleNavigateBack}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            {buttonText}
          </button>
        </div>
      </main>
    </div>
  );
};

export default NotFoundView;
