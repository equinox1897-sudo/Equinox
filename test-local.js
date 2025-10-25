#!/usr/bin/env node
/**
 * Test script to verify local deployment configuration
 * Run with: node test-local.js
 */

import 'dotenv/config';
import { query, initDb } from './db.js';

async function testDatabaseConnection() {
  console.log('🔍 Testing database connection...');
  
  try {
    // Test basic connection
    const result = await query('SELECT NOW() as current_time');
    console.log('✅ Database connection successful');
    console.log(`   Current time: ${result.rows[0].current_time}`);
    
    // Test schema initialization
    console.log('🔍 Testing schema initialization...');
    await initDb();
    console.log('✅ Schema initialization successful');
    
    // Test a simple query on users table
    const userResult = await query('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Users table accessible (${userResult.rows[0].count} users)`);
    
    console.log('\n🎉 All database tests passed!');
    return true;
    
  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    return false;
  }
}

async function testEnvironmentVariables() {
  console.log('🔍 Testing environment variables...');
  
  const required = ['DATABASE_URL'];
  const optional = ['ADMIN_KEY', 'CORS_ORIGINS', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'];
  
  let allGood = true;
  
  for (const env of required) {
    if (process.env[env]) {
      console.log(`✅ ${env} is set`);
    } else {
      console.log(`❌ ${env} is missing (required)`);
      allGood = false;
    }
  }
  
  for (const env of optional) {
    if (process.env[env]) {
      console.log(`✅ ${env} is set`);
    } else {
      console.log(`ℹ️  ${env} is not set (optional)`);
    }
  }
  
  return allGood;
}

async function main() {
  console.log('🚀 Testing local deployment configuration...\n');
  
  const envTest = await testEnvironmentVariables();
  console.log('');
  
  if (!envTest) {
    console.log('❌ Environment variable test failed. Please check your .env file.');
    process.exit(1);
  }
  
  const dbTest = await testDatabaseConnection();
  
  if (dbTest) {
    console.log('\n🎉 All tests passed! Your application is ready for Render deployment.');
    console.log('\nNext steps:');
    console.log('1. Push your code to GitHub');
    console.log('2. Create a Render account and connect your repository');
    console.log('3. Create a PostgreSQL database in Render');
    console.log('4. Deploy your web service with the environment variables');
    console.log('5. Check the RENDER_DEPLOYMENT.md file for detailed instructions');
  } else {
    console.log('\n❌ Some tests failed. Please fix the issues before deploying.');
    process.exit(1);
  }
}

main().catch(console.error);
