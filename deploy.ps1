#!/usr/bin/env powershell
# Deploy Gunfight Arena to Railway in seconds!

Write-Host "🎮 GUNFIGHT ARENA - Deploy Script" -ForegroundColor Cyan
Write-Host ""
Write-Host "This script will deploy your game to Railway.app (FREE!)" -ForegroundColor Yellow
Write-Host ""

# Check if git is installed
$gitCheck = git --version 2>$null
if ($null -eq $gitCheck) {
    Write-Host "❌ Git not found! Install from https://git-scm.com/" -ForegroundColor Red
    exit
}

Write-Host "✅ Git found" -ForegroundColor Green

# Initialize git repo
Write-Host ""
Write-Host "📦 Preparing repository..." -ForegroundColor Cyan
git init
git add .
git commit -m "Initial commit - Gunfight Arena" -q

Write-Host "✅ Repository initialized" -ForegroundColor Green

Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Create GitHub account (if needed): https://github.com/signup" -ForegroundColor White
Write-Host ""
Write-Host "2. Create a new repository on GitHub" -ForegroundColor White
Write-Host "   - Go to https://github.com/new" -ForegroundColor Gray
Write-Host "   - Name it 'gunfight-arena'" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Run these commands:" -ForegroundColor White
Write-Host "   git remote add origin https://github.com/YOUR_USERNAME/gunfight-arena.git" -ForegroundColor Yellow
Write-Host "   git branch -M main" -ForegroundColor Yellow
Write-Host "   git push -u origin main" -ForegroundColor Yellow
Write-Host ""
Write-Host "4. Deploy to Railway:" -ForegroundColor White
Write-Host "   - Go to https://railway.app" -ForegroundColor Gray
Write-Host "   - Click 'Deploy from GitHub'" -ForegroundColor Gray
Write-Host "   - Select your repository" -ForegroundColor Gray
Write-Host "   - Done! You'll get a live URL" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Share the URL with your friends!" -ForegroundColor White
Write-Host ""
Write-Host "🚀 Your game will be live in minutes!" -ForegroundColor Green
Write-Host ""
