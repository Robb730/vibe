import { useEffect } from 'react'

// Adds `.reveal-visible` to all `.reveal` descendants (and self) when scrolled into view.
// Runs once per element, cleans up the observer on unmount.
export default function useReveal(dep) {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.reveal-visible)')
    if (!els.length) return
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('reveal-visible'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal-visible')
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [dep])
}
