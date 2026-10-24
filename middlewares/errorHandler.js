export default (err, req, res, next) => {
    console.error(err.stack || err);
    const status = err.status || 500;
    res.status(status).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
};
