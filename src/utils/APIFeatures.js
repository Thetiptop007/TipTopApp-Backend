/**
 * APIFeatures class for advanced query operations
 * Provides filtering, sorting, field limiting, and pagination
 */
class APIFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }

  /**
   * Filter documents based on query parameters
   * Supports: exact match, greater than (gte), less than (lte), in, etc.
   * Example: ?price[gte]=100&price[lte]=500
   */
  filter() {
    // Create a shallow copy of queryString
    const queryObj = { ...this.queryString };

    // Remove special fields that should not be used for filtering
    const excludedFields = ['page', 'sort', 'limit', 'fields', 'search', 'fuzzy', '_t'];
    excludedFields.forEach((field) => delete queryObj[field]);

    // Handle category filter specially (map category to categories array)
    if (queryObj.category) {
      queryObj.categories = queryObj.category;
      delete queryObj.category;
    }

    // Advanced filtering: replace gte, gt, lte, lt, in, nin with MongoDB operators
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt|in|nin)\b/g, (match) => `$${match}`);

    this.query = this.query.find(JSON.parse(queryStr));

    return this;
  }

  /**
   * Text search functionality with flexible matching
   * Handles partial matches and common typos
   * Example: ?search=chicken → matches "chicken", "Chicken Tikka", etc.
   *          ?search=chiken → matches "chicken" (typo tolerance)
   */
  search() {
    if (this.queryString.search) {
      const searchTerm = this.queryString.search.trim().toLowerCase();
      
      console.log('\n🔍 [SEARCH DEBUG] Search initiated');
      console.log('   Original search term:', searchTerm);
      
      // Store search term for relevance sorting later
      this._searchTerm = searchTerm;
      
      // Get current query conditions
      const currentConditions = this.query.getQuery();
      
      // Escape special regex characters
      const simplePattern = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Common typo mappings (expand as needed)
      const typoMappings = {
        'panir': 'paneer',
        'paner': 'paneer',
        'chiken': 'chicken',
        'chikken': 'chicken',
        'chik': 'chicken',
        'chec': 'chicken',
        'chec': 'chicken',
        'chickin': 'chicken',
        'tand': 'tandoori',
        'tandori': 'tandoori',
        'kadhai': 'kadai',
        'kadai': 'kadhai',
        'biriyani': 'biryani',
        'briyani': 'biryani',
        'naan': 'nan',
        'nan': 'naan',
        'roti': 'rotti',
        'rotti': 'roti',
      };
      
      // Build search patterns - default fields for menu items
      const searchPatterns = [
        // Exact and contains patterns
        { name: { $regex: simplePattern, $options: 'i' } },
        { description: { $regex: simplePattern, $options: 'i' } },
        { categories: { $regex: simplePattern, $options: 'i' } },
        
        // Word-start matching (matches "tand" in "Tandoori", "chik" in "Chicken")
        { name: { $regex: `\\b${simplePattern}`, $options: 'i' } },
        { description: { $regex: `\\b${simplePattern}`, $options: 'i' } },
        
        // User fields (nested)
        { 'name.first': { $regex: simplePattern, $options: 'i' } },
        { 'name.last': { $regex: simplePattern, $options: 'i' } },
        { 'email.address': { $regex: simplePattern, $options: 'i' } },
        { 'phone.number': { $regex: simplePattern, $options: 'i' } },
      ];
      
      // Check for common typo corrections
      const correctedTerm = typoMappings[searchTerm];
      if (correctedTerm) {
        console.log('   ✓ Typo correction applied:', searchTerm, '→', correctedTerm);
        const correctedPattern = correctedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        searchPatterns.push(
          // Exact and contains for corrected term
          { name: { $regex: correctedPattern, $options: 'i' } },
          { description: { $regex: correctedPattern, $options: 'i' } },
          // Word-start for corrected term
          { name: { $regex: `\\b${correctedPattern}`, $options: 'i' } },
          { description: { $regex: `\\b${correctedPattern}`, $options: 'i' } }
        );
      } else {
        console.log('   ℹ No typo correction needed');
      }
      
      // Flexible pattern for typo tolerance (allows 1-2 character differences)
      if (searchTerm.length >= 3) {
        // Pattern 1: Allow optional characters between each letter (handles extra chars)
        const chars = searchTerm.split('');
        const flexiblePattern = chars
          .map((char, i) => {
            const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // For middle characters, allow optional extra char
            if (i < chars.length - 1) {
              return escaped + '.{0,1}';
            }
            return escaped;
          })
          .join('');
        
        searchPatterns.push(
          { name: { $regex: flexiblePattern, $options: 'i' } },
          { description: { $regex: flexiblePattern, $options: 'i' } },
          { 'name.first': { $regex: flexiblePattern, $options: 'i' } },
          { 'name.last': { $regex: flexiblePattern, $options: 'i' } }
        );
        
        // Pattern 2: Allow optional characters at start (handles partial matches like "chik" -> "chicken")
        // This creates patterns like "chik.{0,3}" which allows up to 3 more chars
        const partialPattern = simplePattern + '.{0,5}';
        searchPatterns.push(
          { name: { $regex: `\\b${partialPattern}`, $options: 'i' } },
          { description: { $regex: `\\b${partialPattern}`, $options: 'i' } }
        );
      }
      
      // Word-by-word matching for multi-word queries
      const words = searchTerm.split(/\s+/).filter(w => w.length >= 3);
      words.forEach(word => {
        const wordRegex = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        searchPatterns.push(
          { name: { $regex: wordRegex, $options: 'i' } },
          { 'name.first': { $regex: wordRegex, $options: 'i' } },
          { 'name.last': { $regex: wordRegex, $options: 'i' } }
        );
      });
      
      // Build search filter using $or
      const searchFilter = { $or: searchPatterns };
      
      console.log('   Search patterns created:', searchPatterns.length);
      
      // Merge conditions with existing query
      if (Object.keys(currentConditions).length > 0) {
        console.log('   Merging with existing query conditions');
        if (currentConditions.$and) {
          currentConditions.$and.push(searchFilter);
          this.query.setQuery(currentConditions);
        } else {
          const mergedConditions = {
            $and: [currentConditions, searchFilter]
          };
          this.query.setQuery(mergedConditions);
        }
      } else {
        console.log('   Using search filter as main query');
        this.query.setQuery(searchFilter);
      }
    }

    return this;
  }

  /**
   * Sort documents based on query parameter
   * Example: ?sort=price,-rating (ascending price, descending rating)
   * Default: -createdAt (newest first)
   */
  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.query = this.query.sort(sortBy);
    } else {
      // Default sort by creation date (newest first)
      this.query = this.query.sort('-createdAt');
    }

    return this;
  }

  /**
   * Limit fields returned in response
   * Example: ?fields=name,price,image (only return these fields)
   * Default: exclude __v
   */
  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.query = this.query.select(fields);
    } else {
      // Exclude __v by default
      this.query = this.query.select('-__v');
    }

    return this;
  }

  /**
   * Paginate results
   * Example: ?page=2&limit=10
   * Default: page=1, limit=10
   */
  paginate() {
    const page = parseInt(this.queryString.page, 10) || 1;
    const limit = parseInt(this.queryString.limit, 10) || 10;
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);

    return this;
  }

  /**
   * Populate referenced documents
   * @param {string|object} populateOptions - Field(s) to populate
   */
  populate(populateOptions) {
    if (populateOptions) {
      this.query = this.query.populate(populateOptions);
    }

    return this;
  }

  /**
   * Execute the query and return results with metadata
   * @param {Mongoose.Model} Model - The model to count total documents
   * @returns {Promise<Object>} Results with pagination metadata
   */
  async execute(Model) {
    // Get total count for pagination metadata FIRST
    const page = parseInt(this.queryString.page, 10) || 1;
    const limit = parseInt(this.queryString.limit, 10) || 10;
    
    // For search relevance, we need to get ALL matching documents before pagination
    if (this._searchTerm) {
      console.log('\n📊 [RELEVANCE SCORING] Starting relevance calculation');
      console.log('   Search term:', this._searchTerm);
      
      // Clone the query without skip/limit for relevance sorting
      const queryWithoutPagination = this.query.model.find(this.query.getQuery());
      let allDocs = await queryWithoutPagination.select('-__v').exec();
      
      console.log('   ✓ Found', allDocs.length, 'matching documents');
      
      if (allDocs.length > 0) {
        const searchTerm = this._searchTerm.toLowerCase();
        
        // Typo mappings for relevance scoring (same as search patterns)
        const typoMappings = {
          'panir': 'paneer',
          'paner': 'paneer',
          'chiken': 'chicken',
          'chikken': 'chicken',
          'chik': 'chicken',
          'chec': 'chicken',
          'chickin': 'chicken',
          'tand': 'tandoori',
          'tandori': 'tandoori',
          'kadhai': 'kadai',
          'kadai': 'kadhai',
          'biriyani': 'biryani',
          'briyani': 'biryani',
          'naan': 'nan',
          'nan': 'naan',
          'roti': 'rotti',
          'rotti': 'roti',
        };
        
        const correctedSearchTerm = typoMappings[searchTerm] || searchTerm;
        
        if (correctedSearchTerm !== searchTerm) {
          console.log('   ✓ Using corrected term for scoring:', searchTerm, '→', correctedSearchTerm);
        }
        
        allDocs = allDocs.map(doc => {
          const docObj = doc.toObject ? doc.toObject() : doc;
          
          // Handle both MenuItem and User documents
          let searchableText = '';
          
          // For MenuItem
          if (docObj.name && typeof docObj.name === 'string') {
            searchableText = docObj.name.toLowerCase();
          }
          // For User
          else if (docObj.name && typeof docObj.name === 'object') {
            const firstName = docObj.name.first || '';
            const lastName = docObj.name.last || '';
            searchableText = `${firstName} ${lastName}`.toLowerCase().trim();
          }
          
          const description = (docObj.description || '').toLowerCase();
          const categories = (docObj.categories || []).map(c => c.toLowerCase());
          const email = (docObj.email?.address || '').toLowerCase();
          const phone = (docObj.phone?.number || '').toLowerCase();
          
          let relevanceScore = 0;
          const nameWords = searchableText.split(/\s+/);
          const descWords = description.split(/\s+/);
          
          // Helper function to check match with both original and corrected terms
          const checkMatch = (text, checkFn) => {
            return checkFn(text, searchTerm) || (correctedSearchTerm !== searchTerm && checkFn(text, correctedSearchTerm));
          };
          
          // NAME MATCHES (10000-50000 points) - Heavily prioritized
          // Exact match in name
          if (searchableText === searchTerm || searchableText === correctedSearchTerm) {
            relevanceScore = 50000;
          }
          // Starts with search term in name
          else if (searchableText.startsWith(searchTerm) || searchableText.startsWith(correctedSearchTerm)) {
            relevanceScore = 40000;
          }
          // Any word in name starts with search term (e.g., "tand" matches "Tandoori", "chik" matches "Chicken")
          else if (nameWords.some(word => word.startsWith(searchTerm) || word.startsWith(correctedSearchTerm))) {
            relevanceScore = 35000;
            // Bonus if it's the first word
            if (nameWords[0].startsWith(searchTerm) || nameWords[0].startsWith(correctedSearchTerm)) {
              relevanceScore += 5000;
            }
          }
          // Exact word match in name
          else if (nameWords.includes(searchTerm) || nameWords.includes(correctedSearchTerm)) {
            relevanceScore = 30000;
          }
          // Contains search term anywhere in name
          else if (searchableText.includes(searchTerm) || searchableText.includes(correctedSearchTerm)) {
            const position = searchableText.indexOf(searchTerm);
            const correctedPosition = searchableText.indexOf(correctedSearchTerm);
            const actualPosition = position >= 0 ? position : correctedPosition;
            relevanceScore = 25000 - (actualPosition * 10);
          }
          // Partial word match in name (word contains search term)
          else if (nameWords.some(word => word.includes(searchTerm) || word.includes(correctedSearchTerm))) {
            relevanceScore = 20000;
          }
          
          // CATEGORY MATCHES (5000-8000 points)
          else if (categories.some(cat => cat === searchTerm)) {
            relevanceScore = 8000;
          }
          else if (categories.some(cat => cat.includes(searchTerm))) {
            relevanceScore = 6000;
          }
          
          // EMAIL/PHONE MATCHES (3000-5000 points)
          else if (email === searchTerm) {
            relevanceScore = 5000;
          }
          else if (phone.includes(searchTerm)) {
            relevanceScore = 4000;
          }
          else if (email.includes(searchTerm)) {
            relevanceScore = 3000;
          }
          
          // DESCRIPTION MATCHES (500-2000 points) - Much lower priority
          else if (descWords.some(word => word.startsWith(searchTerm) || word.startsWith(correctedSearchTerm))) {
            relevanceScore = 2000;
          }
          else if (descWords.some(word => word === searchTerm || word === correctedSearchTerm)) {
            relevanceScore = 1500;
          }
          else if (description.includes(searchTerm) || description.includes(correctedSearchTerm)) {
            relevanceScore = 1000;
          }
          else if (descWords.some(word => word.includes(searchTerm) || word.includes(correctedSearchTerm))) {
            relevanceScore = 500;
          }
          
          // FUZZY MATCHES (100-200 points) - Lowest priority
          else {
            relevanceScore = 100;
          }
          
          // Small boost for quality (max 100 points total - won't change ranking significantly)
          if (docObj.rating) {
            relevanceScore += (docObj.rating || 0) * 5; // max 25 points
          }
          if (docObj.reviews) {
            relevanceScore += Math.min((docObj.reviews || 0), 50); // max 50 points
          }
          if (docObj.isActive !== undefined && docObj.isActive) {
            relevanceScore += 10; // 10 points
          }
          
          return { doc, relevanceScore };
        });
        
        // Sort by relevance score (highest first)
        allDocs.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        // Log top 10 results with scores
        console.log('\n   📋 Top results by relevance:');
        allDocs.slice(0, 10).forEach((item, index) => {
          const docObj = item.doc.toObject ? item.doc.toObject() : item.doc;
          const name = docObj.name && typeof docObj.name === 'string' 
            ? docObj.name 
            : `${docObj.name?.first || ''} ${docObj.name?.last || ''}`.trim();
          console.log(`   ${index + 1}. [${item.relevanceScore}] ${name}`);
        });
        
        // Extract just the documents
        allDocs = allDocs.map(item => item.doc);
        
        // Apply pagination AFTER sorting
        const skip = (page - 1) * limit;
        const docs = allDocs.slice(skip, skip + limit);
        const total = allDocs.length;
        const totalPages = Math.ceil(total / limit);
        
        console.log(`\n   ✓ Returning page ${page}/${totalPages} (${docs.length} items)`);
        console.log('─────────────────────────────────────────\n');
        
        return {
          data: docs,
          pagination: {
            currentPage: page,
            totalPages: totalPages,
            totalItems: total,
            itemsPerPage: limit,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
        };
      }
    }
    
    // Execute the query normally (no search term or no results)
    const docs = await this.query;

    // Use the actual query conditions for counting instead of rebuilding
    const countQuery = this.query.model.find(this.query.getQuery());
    const total = await countQuery.countDocuments();
    const totalPages = Math.ceil(total / limit);

    return {
      data: docs,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: total,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }
}

module.exports = APIFeatures;
