#!/bin/bash

# Create public directory
mkdir -p public

# Build Hugo site (it will output to movies/ because of publishDir)
cd movies-hugo
hugo
cd ..

# Move the built movies folder into public
mv movies public/

# Copy your landing page files
cp index.html public/
cp oneko*.js public/
cp oneko.gif public/

echo "Build complete!"