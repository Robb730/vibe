import { useEffect, useRef, useState } from 'react'

// Ping-pong marquee for long song titles: static truncate when the text fits,
// slow left-right scroll when it overflows. Respects reduced-motion.
export default function Marquee({ children, className = '', label, speed = 40 }) {
  const wrapRef = useRef(null)
  const innerRef = useRef(null)
  const [dist, setDist] = useState(0)

  const text = label ?? (typeof children === 'string' ? children : undefined)

  useEffect(() => {
    function measure() {
      const wrap = wrapRef.current
      const inner = innerRef.current
      if (!wrap || !inner) return
      const overflow = inner.scrollWidth - wrap.clientWidth
      setDist((d) => {
        const next = overflow > 4 ? overflow : 0
        return next === d ? d : next
      })
    }
    measure()
    window.addEventListener('resize', measure)
    const t = setTimeout(measure, 600)
    if (document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {})
    }
    return () => {
      window.removeEventListener('resize', measure)
      clearTimeout(t)
    }
  }, [children])

  const animating = dist > 0
  const dur = animating ? Math.max(1.8, dist / speed) : 0

  return (
    <span
      ref={wrapRef}
      title={text}
      aria-label={text}
      className={`block min-w-0 overflow-hidden whitespace-nowrap ${className}`}
    >
      <span
        ref={innerRef}
        style={animating ? { '--marquee-dist': `${dist}px`, animationDuration: `${dur}s` } : undefined}
        className={animating ? 'marquee-inner inline-block will-change-transform' : 'block truncate'}
      >
        {children}
      </span>
    </span>
  )
}
