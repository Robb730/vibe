import { useEffect, useRef, useState } from 'react'

// Eased count-up for dramatic tallies. Returns the current displayed value.
export function useCountUp(target, duration = 1100, start = true) {
  const [value, setValue] = useState(0)
  const raf = useRef(null)

  useEffect(() => {
    if (!start) {
      setValue(0)
      return
    }
    let stopped = false
    const t0 = performance.now()
    function tick(t) {
      if (stopped) return
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(eased * target))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      stopped = true
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [target, duration, start])

  return value
}
