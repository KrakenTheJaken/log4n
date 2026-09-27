# long reviews

One markdown file per film, named after the film's Letterboxd slug
(the bit after `/film/` in its Letterboxd URL):

    reviews/double-indemnity.md

Write normal markdown and push. The film page picks it up on the next deploy,
and the "sync films" Action updates the film's tags and "review" badge.

Only files named exactly `reviews/<slug>.md` show up. `examples/` and `drafts/`
are in `.gitignore`, so they stay on your computer and never go live.

## the file for each film

The sync creates `reviews/<slug>.md` for every film you review on Letterboxd,
already filled in (git pull before editing, since the Action adds these):

    ---
    tags:
    genres: crime, thriller
    cast: Fred MacMurray, Barbara Stanwyck, Edward G. Robinson, Porter Hall
    ---

- `tags` are your own ("my tags" filter).
- `genres` and `cast` show exactly as written, so add or remove freely.
  Delete a whole line to go back to what Letterboxd says.
- Text under the block is the review. No text means it's not a review, just tags.
- Rewatched a film? Its page features your latest Letterboxd review. Add
  `quote: first` (or `quote: 2026-09-24`, a watch date) to feature another one.

## everything else

`examples/formatting-guide.md` shows every trick (images, captions, spoilers,
tables, ...) with the exact text to type. View it on the local server:

    http://localhost:8000/film.html?f=double-indemnity&review=examples/formatting-guide

`&review=<path>` works on any film page for previewing drafts too.
Images go in `reviews/images/`.
