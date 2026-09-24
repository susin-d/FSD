import mongoose from 'mongoose';

const connect_db = async (db_url) =>{
    try{
        await mongoose.connect(db_url);
        console.log('MongoDB is Connected');
    }
    catch(err){
        console.log('MongoDB Connection Failed'+err.message);
        process.exit(1);
    }
};

export default connect_db;