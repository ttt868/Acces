#!/usr/bin/env python3
import re

# Read the file
with open('top-accounts.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update Statistics Section
stats_old = '''        <!-- Statistics -->
        <div class="stats-section">
            <div class="stat-card">
                <div class="stat-label">Transactions (24H)</div>
                <div class="stat-value" id="dailyTxCount">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Pending Transactions</div>
                <div class="stat-value" id="pendingTxCount">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Transaction Fee (24H)</div>
                <div class="stat-value" id="dailyFees">0.00 access</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Avg. Transaction Fee</div>
                <div class="stat-value" id="avgFee">0.00002 access</div>
            </div>
        </div>'''

stats_new = '''        <!-- Statistics -->
        <div class="stats-section">
            <div class="stat-card">
                <div class="stat-label">Total Accounts</div>
                <div class="stat-value" id="totalAccounts">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Supply</div>
                <div class="stat-value" id="totalSupply">0.00 ACCESS</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Top 10 Holdings</div>
                <div class="stat-value" id="top10Holdings">0%</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Top 100 Holdings</div>
                <div class="stat-value" id="top100Holdings">0%</div>
            </div>
        </div>'''

content = content.replace(stats_old, stats_new)

# 2. Update Table Section Header
header_old = '''            <div class="section-header" style="display: block; padding: 16px 20px;">
                <div style="margin-bottom: 12px;">
                    <span style="color: var(--text-primary); font-size: 16px; font-weight: 400;">
                        More than <span id="totalTxCount">0</span> transactions found
                    </span>
                    <br>
                    <span style="color: var(--text-secondary); font-size: 13px;">
                        (Showing transactions between #<span id="startTxNumber">0</span> to #<span id="endTxNumber">0</span>)
                    </span>
                </div>'''

header_new = '''            <div class="section-header" style="display: block; padding: 16px 20px;">
                <div style="margin-bottom: 12px;">
                    <span style="color: var(--text-primary); font-size: 16px; font-weight: 400;">
                        More than <span id="totalAccountsCount">0</span> accounts found
                    </span>
                    <br>
                    <span style="color: var(--text-secondary); font-size: 13px;">
                        (Total Supply: <span id="totalSupplyText">0</span> ACCESS)
                    </span>
                </div>'''

content = content.replace(header_old, header_new)

# 3. Update Table Headers
table_head_old = '''                    <thead>
                        <tr>
                            <th></th>
                            <th>Transaction Hash</th>
                            <th>Method</th>
                            <th>Block</th>
                            <th>Age</th>
                            <th>From</th>
                            <th>To</th>
                            <th>Amount</th>
                            <th>Txn Fee</th>
                        </tr>
                    </thead>'''

table_head_new = '''                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Address</th>
                            <th>Name Tag</th>
                            <th>Balance</th>
                            <th>Percentage</th>
                            <th>Txn Count</th>
                        </tr>
                    </thead>'''

content = content.replace(table_head_old, table_head_new)

# 4. Update tbody id
content = content.replace('id="transactionsTableBody"', 'id="accountsTableBody"')

# 5. Update loading message
content = content.replace('<p>Loading transactions...</p>', '<p>Loading top accounts...</p>')

# 6. Update function names in JavaScript section (we'll do this manually)

# Write the updated content
with open('top-accounts.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ File updated successfully!")
