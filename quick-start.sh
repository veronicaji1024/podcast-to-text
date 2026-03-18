#!/bin/bash

# Podcast AI - Quick Setup Script
# This script sets up the development environment

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                 Podcast AI Quick Setup                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

# Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}✓ Node.js:$(node -v)${NC}"

# Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}✗ Python 3 not found${NC}"
    echo "Please install Python 3.8+ from https://python.org/"
    exit 1
fi
echo -e "${GREEN}✓ Python:$(python3 --version)${NC}"

# pip
if ! command -v pip3 &> /dev/null; then
    echo -e "${RED}✗ pip3 not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ pip3 found${NC}"

echo ""
echo -e "${BLUE}Installing dependencies...${NC}"

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install

# Install Python dependencies
echo "Installing Python dependencies..."
pip3 install faster-whisper

# Optional: Install ffmpeg for better audio handling
if command -v ffmpeg &> /dev/null; then
    echo -e "${GREEN}✓ ffmpeg found${NC}"
else
    echo -e "${YELLOW}! ffmpeg not found (optional, for better audio info)${NC}"
    echo "  Install with:"
    echo "    macOS:   brew install ffmpeg"
    echo "    Ubuntu:  sudo apt-get install ffmpeg"
    echo "    Windows: choco install ffmpeg"
fi

# Setup environment file
if [ ! -f .env ]; then
    echo ""
    echo -e "${BLUE}Setting up environment...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}Please edit .env file and add your OpenAI API key${NC}"
fi

# Create temp directory
mkdir -p server/temp

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                   Setup Complete!                          ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Next steps:"
echo -e "  1. Edit ${YELLOW}.env${NC} file and add your OpenAI API key"
echo -e "  2. Run ${YELLOW}npm start${NC} or ${YELLOW}./start.sh${NC} to start the server"
echo -e "  3. Open ${YELLOW}http://localhost:3000${NC} in your browser"
echo ""
echo -e "Optional: Change Whisper model in .env file:"
echo -e "  - tiny:   Fastest, lowest accuracy"
echo -e "  - base:   Fast, good accuracy (default)"
echo -e "  - small:  Balanced speed/accuracy"
echo -e "  - medium: Slower, better accuracy"
echo -e "  - large:  Slowest, best accuracy"
echo ""
