import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { catalogApi } from '../api/catalog'
import { useCity } from '../app/city-context'
import { useAsync } from '../app/use-async'
import { useNow } from '../app/use-now'
import { MovieCard } from '../components/MovieCard'
import { FeaturedCarousel } from '../components/FeaturedCarousel'
import { MovieRail } from '../components/MovieRail'
import { EmptyState, ErrorState, Loading } from '../components/feedback'

function uniqueTitles(items: Awaited<ReturnType<typeof catalogApi.movies>>['items']) {
  const seen = new Set<string>()
  return items.filter(movie => {
    const title = movie.title.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const key = `${title}:${movie.releaseDate.slice(0, 10)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function HomePage() {
  const city = useCity()
  if (city.loading) return <main className="page-shell"><Loading label="Loading your location…" /></main>
  if (city.error) return <main className="page-shell"><ErrorState error={city.error} retry={city.retry} /></main>
  return <MovieCatalog key={city.cityId} />
}
function MovieCatalog() {
  const [params, setParams] = useSearchParams(), { cityId } = useCity()
  const now = useNow()
  const search = params.get('search') ?? '', language = params.get('language') ?? '', genre = params.get('genre') ?? ''
  const load = useCallback(async (signal: AbortSignal) => {
    const fetchAll = async (forCity?: string) => {
      const movies = new Map<string, Awaited<ReturnType<typeof catalogApi.movies>>['items'][number]>()
      for (let page = 1; ; page++) {
        const result = await catalogApi.movies({ search, language, genre, cityId: forCity, page, limit: 100 }, signal)
        result.items.forEach(movie => movies.set(movie.id, movie))
        if (result.items.length < result.limit) break
      }
      return [...movies.values()]
    }
    const allMovies = await fetchAll()
    if (!cityId) return allMovies
    const cityMatches = new Map((await fetchAll(cityId)).map(movie => [movie.id, movie.bookingAvailability]))
    return allMovies.map(movie => ({ ...movie, bookingAvailability: cityMatches.get(movie.id) ?? { cityId, hasShows: false } }))
  }, [search, language, genre, cityId])
  const resource = useAsync(`movies:${cityId}:${search}:${language}:${genre}`, load)
  if (resource.loading) return <main className="page-shell"><Loading label="Loading movies…" /></main>
  if (resource.error) return <main className="page-shell"><ErrorState error={resource.error} retry={resource.reload} /></main>
  const movies = uniqueTitles(resource.data!)
  const oneYearAgo = new Date(now)
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1)
  const filtered = Boolean(search || language || genre)
  const recent = (movie: typeof movies[number]) => {
    const release = Date.parse(movie.releaseDate)
    return release <= now && release >= oneYearAgo.getTime()
  }
  const englishReleases = movies.filter(movie => recent(movie) && movie.language.toLowerCase() === 'english').sort((a,b)=>Date.parse(b.releaseDate)-Date.parse(a.releaseDate))
  const hindiReleases = movies.filter(movie => recent(movie) && movie.language.toLowerCase() === 'hindi').sort((a,b)=>Date.parse(b.releaseDate)-Date.parse(a.releaseDate))
  const firstLanguage = Date.parse(englishReleases[0]?.releaseDate ?? '') >= Date.parse(hindiReleases[0]?.releaseDate ?? '') ? englishReleases : hindiReleases
  const secondLanguage = firstLanguage === englishReleases ? hindiReleases : englishReleases
  const latestReleases: typeof movies = []
  for (let index = 0; latestReleases.length < 5 && (index < firstLanguage.length || index < secondLanguage.length); index++) {
    if (firstLanguage[index]) latestReleases.push(firstLanguage[index])
    if (secondLanguage[index] && latestReleases.length < 5) latestReleases.push(secondLanguage[index])
  }
  const featured = filtered ? [] : latestReleases.sort((a,b)=>Date.parse(b.releaseDate)-Date.parse(a.releaseDate))
  const featuredIds = new Set(featured.map(movie => movie.id))
  const catalogMovies = movies.filter(movie => !featuredIds.has(movie.id))
  const unassigned = new Set(catalogMovies.map(movie => movie.id))
  const take = (matches: (movie: typeof movies[number]) => boolean) => catalogMovies.filter(movie => {
    if (!unassigned.has(movie.id) || !matches(movie)) return false
    unassigned.delete(movie.id)
    return true
  })
  const comingSoon = take(movie => Date.parse(movie.releaseDate) > now).sort((a,b)=>Date.parse(a.releaseDate)-Date.parse(b.releaseDate))
  const nowShowing = take(movie => recent(movie) && Boolean(movie.bookingAvailability?.hasShows))
  const bollywood = take(movie => recent(movie) && movie.language.toLowerCase() === 'hindi')
  const hollywood = take(movie => recent(movie) && movie.language.toLowerCase() === 'english')
  const south = take(movie => recent(movie) && ['telugu', 'tamil', 'kannada', 'malayalam'].includes(movie.language.toLowerCase()))
  const otherRecent = take(recent)
  const classics = take(movie => Date.parse(movie.releaseDate) < oneYearAgo.getTime())
  return <main className="page-shell movies-home">
    {featured.length > 0 && <FeaturedCarousel key={featured.map(movie => movie.id).join(':')} movies={featured} />}
    <div className="catalog-intro"><div><p className="eyebrow">THE BIG SCREEN AWAITS</p><h2>Find your next story.</h2></div></div>
    <form id="catalog-filters" className="catalog-filters" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget), next = new URLSearchParams()
      for (const key of ['search', 'language', 'genre']) { const value = String(form.get(key) ?? '').trim(); if (value) next.set(key, value) }
      setParams(next)
    }}><label>Search movies<input className="input mt-2" name="search" type="search" defaultValue={search} maxLength={100} placeholder="Find a film…" /></label><label>Language<input className="input mt-2" name="language" defaultValue={language} maxLength={50} placeholder="All languages" /></label><label>Genre<input className="input mt-2" name="genre" defaultValue={genre} maxLength={50} placeholder="Every kind of story" /></label><button className="secondary" type="submit">Find movies</button></form>
    {!movies.length ? <EmptyState title="No movies available" detail="No movies match these filters. Try another title, language or genre." /> : <>
      {!filtered && <>
        <MovieRail title="Coming Soon" subtitle="The stories arriving on the big screen next." movies={comingSoon} />
        <MovieRail title="Now Showing" subtitle="Find a showtime near you." movies={nowShowing} />
        <MovieRail title="Bollywood Blockbusters" subtitle="Fresh Hindi releases worth watching." movies={bollywood} />
        <MovieRail title="Hollywood Hits" subtitle="The latest stories from Hollywood." movies={hollywood} />
        <MovieRail title="South Hits" subtitle="New stories from across southern Indian cinema." movies={south} />
        <MovieRail title="More New Releases" subtitle="Recently released movies across every language." movies={otherRecent} />
        <section className="catalog-section" aria-label="CineHook Classics"><div className="section-heading"><div><h2>CineHook Classics</h2><p>Beloved stories released more than a year ago.</p></div></div><div className="movie-grid">{classics.map(movie => <MovieCard key={movie.id} movie={movie} />)}</div></section>
      </>}
      {filtered && <section className="catalog-section" aria-label="Movie search results"><div className="section-heading"><div><h2>Search results</h2><p>{movies.length} films</p></div></div><div className="movie-grid">{movies.map(movie => <MovieCard key={movie.id} movie={movie} />)}</div></section>}
    </>}
  </main>
}
