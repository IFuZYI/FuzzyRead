import React, { useState } from 'react';

interface ArticleImageProps {
  key?: string;
  src: string;
  alt: string;
  id: string;
}

/**
 * Apple-style article figure: the image is the subject — no border, no card
 * chrome, one soft radius, caption set quietly below.
 */
export default function ArticleImage({ src, alt, id }: ArticleImageProps) {
  const [hasError, setHasError] = useState(false);
  const hasCaption = alt && alt !== 'Illustration';

  if (hasError) {
    return (
      <figure
        className="my-9 rounded-2xl bg-[#f5f5f7] px-8 py-14 text-center animate-fade-in"
        id={`article-image-box-fallback-${id}`}
      >
        <p className="text-[14px] text-gray-500 leading-[1.35] max-w-sm mx-auto">
          {hasCaption ? alt : '配图当前不可用。'}
        </p>
      </figure>
    );
  }

  return (
    <figure className="my-9 animate-fade-in" id={`article-image-box-${id}`}>
      <img 
        src={src} 
        alt={alt} 
        referrerPolicy="no-referrer" 
        loading="lazy"
        className="w-full h-auto rounded-2xl" 
        id={`article-img-${id}`}
        onError={() => setHasError(true)}
      />
      {hasCaption && (
        <figcaption className="mt-3 text-[13px] text-gray-500 leading-[1.4]" id={`article-img-caption-${id}`}>
          {alt}
        </figcaption>
      )}
    </figure>
  );
}
